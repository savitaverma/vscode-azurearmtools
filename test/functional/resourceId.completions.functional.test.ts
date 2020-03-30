// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

// tslint:disable:no-unused-expression max-func-body-length promise-function-async max-line-length no-unnecessary-class
// tslint:disable:no-non-null-assertion object-literal-key-quotes variable-name no-constant-condition
// tslint:disable:prefer-template no-http-string

import { commands, Selection } from 'vscode';
import { ext } from '../../src/extensionVariables';
import { assert } from '../../src/fixed_assert';
import { delay } from '../support/delay';
import { IDeploymentParametersFile, IDeploymentTemplate } from "../support/diagnostics";
import { getCompletionItemResolutionPromise, getCompletionItemsPromise, getDocumentChangedPromise } from '../support/getEventPromise';
import { getDocumentMarkers, removeEOLMarker } from "../support/parseTemplate";
import { stringify } from '../support/stringify';
import { TempDocument, TempEditor, TempFile } from '../support/TempFile';
import { testWithLanguageServer } from '../support/testWithLanguageServer';

const newParamCompletionLabel = `"<new parameter>"`;

const defaultTemplate = {
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "agentCount": {
            "minValue": 1,
            "maxValue": 100,
            "defaultValue": 2,
            "metadata": {
                "description": "The number of agents for the cluster.  This value can be from 1 to 100"
            },
            "type": "int"
        },
        "agentEndpointDNSNamePrefix": {
            "metadata": {
                "description": "Sets the Domain name label for the agent pool IP Address.  The concatenation of the domain name label and the regional DNS zone make up the fully qualified domain name associated with the public IP address."
            },
            "type": "string"
        },
        "agentSubnet": {
            "defaultValue": "10.0.0.0/16",
            "metadata": {
                "description": "Sets the subnet of agent pool 'agent'."
            },
            "type": "string"
        },
        "agentVMSize": {
            "allowedValues": [
                "Basic_A2"
            ],
            "defaultValue": "Standard_D2_v2",
            "metadata": {
                "description": "The size of the Virtual Machine."
            },
            "type": "string"
        },
        "firstConsecutiveStaticIP": {
            "defaultValue": "172.16.0.5",
            "metadata": {
                "description": "Sets the static IP of the first master"
            },
            "type": "string"
        },
        "linuxAdminUsername": {
            "metadata": {
                "description": "User name for the Linux Virtual Machines (SSH or Password)."
            },
            "type": "string"
        },
        "location": {
            "defaultValue": "[resourceGroup().location]",
            "metadata": {
                "description": "Sets the location for all resources in the cluster"
            },
            "type": "string"
        },
        "masterEndpointDNSNamePrefix": {
            "metadata": {
                "description": "Sets the Domain name label for the master IP Address.  The concatenation of the domain name label and the regional DNS zone make up the fully qualified domain name associated with the public IP address."
            },
            "type": "string"
        },
        "masterSubnet": {
            "defaultValue": "172.16.0.0/24",
            "metadata": {
                "description": "Sets the subnet of the master node(s)."
            },
            "type": "string"
        },
        "masterVMSize": {
            "allowedValues": [
                "Basic_A2"
            ],
            "metadata": {
                "description": "The size of the Virtual Machine."
            },
            "type": "string"
        },
        "nameSuffix": {
            "defaultValue": "13957614",
            "metadata": {
                "description": "A string hash of the master DNS name to uniquely identify the cluster."
            },
            "type": "string"
        },
        "sshRSAPublicKey": {
            "metadata": {
                "description": "SSH public key used for auth to all Linux machines.  Not Required.  If not set, you must provide a password key."
            },
            "type": "string"
        }
    },
    "variables": {
        "adminUsername": "[parameters('linuxAdminUsername')]",
        "agentCount": "[parameters('agentCount')]",
        "agentCustomScript": "[concat('/usr/bin/nohup /bin/bash -c \"/bin/bash /opt/azure/containers/',variables('configureClusterScriptFile'), ' ',variables('clusterInstallParameters'),' >> /var/log/azure/cluster-bootstrap.log 2>&1 &\" &')]",
        "agentEndpointDNSNamePrefix": "[tolower(parameters('agentEndpointDNSNamePrefix'))]",
        "agentIPAddressName": "[concat(variables('orchestratorName'), '-agent-ip-', variables('agentEndpointDNSNamePrefix'), '-', variables('nameSuffix'))]",
        "agentLbBackendPoolName": "[concat(variables('orchestratorName'), '-agent-', variables('nameSuffix'))]",
        "agentLbID": "[resourceId('Microsoft.Network/loadBalancers',variables('agentLbName'))]",
        "agentLbIPConfigID": "[concat(variables('agentLbID'),'/frontendIPConfigurations/', variables('agentLbIPConfigName'))]",
        "agentLbIPConfigName": "[concat(variables('orchestratorName'), '-agent-', variables('nameSuffix'))]",
        "agentLbName": "[concat(variables('orchestratorName'), '-agent-', variables('nameSuffix'))]",
        "agentRunCmd": "[concat('runcmd:\n -  [ /bin/bash, /opt/azure/containers/install-cluster.sh ]\n\n')]",
        "agentRunCmdFile": "[concat(' -  content: |\n        #!/bin/bash\n        ','sudo mkdir -p /var/log/azure\n        ',variables('agentCustomScript'),'\n    path: /opt/azure/containers/install-cluster.sh\n    permissions: \"0744\"\n')]",
        "agentSubnet": "[parameters('agentSubnet')]",
        "agentSubnetName": "[concat(variables('orchestratorName'), '-agentsubnet')]",
        "agentVMNamePrefix": "[concat(variables('orchestratorName'), '-agent-', variables('nameSuffix'))]",
        "agentVMSize": "[parameters('agentVMSize')]",
        "agentVnetSubnetID": "[resourceId('Microsoft.Network/virtualNetworks/subnets', variables('virtualNetworkName'), variables('agentSubnetName'))]",
        "clusterInstallParameters": "[concat(variables('masterCount'), ' ',variables('masterVMNamePrefix'), ' ',variables('masterFirstAddrOctet4'), ' ',variables('adminUsername'),' ',variables('postInstallScriptURI'),' ',variables('masterFirstAddrPrefix'))]",
        "configureClusterScriptFile": "configure-swarmmode-cluster.sh",
        "location": "[variables('locations')[mod(add(2,length(parameters('location'))),add(1,length(parameters('location'))))]]",
        "locations": [
            "[parameters('location')]",
            "[parameters('location')]"
        ],
        "masterAvailabilitySet": "[concat(variables('orchestratorName'), '-master-availabilitySet-', variables('nameSuffix'))]",
        "masterCount": 1,
        "masterCustomScript": "[concat('/bin/bash -c \"/bin/bash /opt/azure/containers/',variables('configureClusterScriptFile'), ' ',variables('clusterInstallParameters'),' >> /var/log/azure/cluster-bootstrap.log 2>&1\"')]",
        "masterEndpointDNSNamePrefix": "[tolower(parameters('masterEndpointDNSNamePrefix'))]",
        "masterFirstAddrOctet4": "[variables('masterFirstAddrOctets')[3]]",
        "masterFirstAddrOctets": "[split(parameters('firstConsecutiveStaticIP'),'.')]",
        "masterFirstAddrPrefix": "[concat(variables('masterFirstAddrOctets')[0],'.',variables('masterFirstAddrOctets')[1],'.',variables('masterFirstAddrOctets')[2],'.')]",
        "masterLbBackendPoolName": "[concat(variables('orchestratorName'), '-master-pool-', variables('nameSuffix'))]",
        "masterLbID": "[resourceId('Microsoft.Network/loadBalancers',variables('masterLbName'))]",
        "masterLbIPConfigID": "[concat(variables('masterLbID'),'/frontendIPConfigurations/', variables('masterLbIPConfigName'))]",
        "masterLbIPConfigName": "[concat(variables('orchestratorName'), '-master-lbFrontEnd-', variables('nameSuffix'))]",
        "masterLbInboundNatRules": [
            [
                {
                    "id": "[concat(variables('masterSshInboundNatRuleIdPrefix'),'0')]"
                },
                {
                    "id": "[concat(variables('masterSshPort22InboundNatRuleIdPrefix'),'0')]"
                }
            ],
            [
                {
                    "id": "[concat(variables('masterSshInboundNatRuleIdPrefix'),'1')]"
                }
            ],
            [
                {
                    "id": "[concat(variables('masterSshInboundNatRuleIdPrefix'),'2')]"
                }
            ],
            [
                {
                    "id": "[concat(variables('masterSshInboundNatRuleIdPrefix'),'3')]"
                }
            ],
            [
                {
                    "id": "[concat(variables('masterSshInboundNatRuleIdPrefix'),'4')]"
                }
            ]
        ],
        "masterLbName": "[concat(variables('orchestratorName'), '-master-lb-', variables('nameSuffix'))]",
        "masterPublicIPAddressName": "[concat(variables('orchestratorName'), '-master-ip-', variables('masterEndpointDNSNamePrefix'), '-', variables('nameSuffix'))]",
        "masterSshInboundNatRuleIdPrefix": "[concat(variables('masterLbID'),'/inboundNatRules/SSH-',variables('masterVMNamePrefix'))]",
        "masterSshPort22InboundNatRuleIdPrefix": "[concat(variables('masterLbID'),'/inboundNatRules/SSHPort22-',variables('masterVMNamePrefix'))]",
        "masterSshPort22InboundNatRuleNamePrefix": "[concat(variables('masterLbName'),'/SSHPort22-',variables('masterVMNamePrefix'))]",
        "masterSubnet": "[parameters('masterSubnet')]",
        "masterSubnetName": "[concat(variables('orchestratorName'), '-masterSubnet')]",
        "masterVMNamePrefix": "[concat(variables('orchestratorName'), '-master-', variables('nameSuffix'), '-')]",
        "masterVMSize": "[parameters('masterVMSize')]",
        "masterVnetSubnetID": "[resourceId('Microsoft.Network/virtualNetworks/subnets', variables('virtualNetworkName'), variables('masterSubnetName'))]",
        "nameSuffix": "[parameters('nameSuffix')]",
        "orchestratorName": "swarmm",
        "osImageOffer": "UbuntuServer",
        "osImagePublisher": "Canonical",
        "osImageSKU": "16.04-LTS",
        "osImageVersion": "16.04.201703070",
        "postInstallScriptURI": "disabled",
        "sshKeyPath": "[concat('/home/', variables('adminUsername'), '/.ssh/authorized_keys')]",
        "sshRSAPublicKey": "[parameters('sshRSAPublicKey')]",
        "virtualNetworkName": "[concat(variables('orchestratorName'), '-vnet-', variables('nameSuffix'))]",
        "vmSizesMap": {
            "Basic_A2": {
                "diskType": "Standard_LRS"
            }
        }
    },
    "resources": [
        {
            "apiVersion": "2016-03-30",
            "location": "[variables('location')]",
            "name": "[variables('agentIPAddressName')]",
            "properties": {
                "dnsSettings": {
                    "domainNameLabel": "[variables('agentEndpointDNSNamePrefix')]"
                },
                "publicIPAllocationMethod": "Dynamic"
            },
            "type": "Microsoft.Network/publicIPAddresses"
        },
        {
            "apiVersion": "2016-03-30",
            "type": "Microsoft.Network/loadBalancers",
            "dependsOn": [
                "[concat('Microsoft.Network/publicIPAddresses/', variables('agentIPAddressName'))]"
            ],
            "location": "[variables('location')]",
            "name": "[variables('agentLbName')]",
            "properties": {
                "backendAddressPools": [
                    {
                        "name": "[variables('agentLbBackendPoolName')]"
                    }
                ],
                "frontendIPConfigurations": [
                    {
                        "name": "[variables('agentLbIPConfigName')]",
                        "properties": {
                            "publicIPAddress": {
                                "id": "[resourceId('Microsoft.Network/publicIPAddresses',variables('agentIPAddressName'))]"
                            }
                        }
                    }
                ],
                "inboundNatRules": [],
                "loadBalancingRules": [
                    {
                        "name": "LBRule80",
                        "properties": {
                            "backendAddressPool": {
                                "id": "[concat(variables('agentLbID'), '/backendAddressPools/', variables('agentLbBackendPoolName'))]"
                            },
                            "backendPort": 80,
                            "enableFloatingIP": false,
                            "frontendIPConfiguration": {
                                "id": "[variables('agentLbIPConfigID')]"
                            },
                            "frontendPort": 80,
                            "idleTimeoutInMinutes": 5,
                            "loadDistribution": "Default",
                            "probe": {
                                "id": "[concat(variables('agentLbID'),'/probes/tcp80Probe')]"
                            },
                            "protocol": "Tcp"
                        }
                    },
                    {
                        "name": "LBRule443",
                        "properties": {
                            "backendAddressPool": {
                                "id": "[concat(variables('agentLbID'), '/backendAddressPools/', variables('agentLbBackendPoolName'))]"
                            },
                            "backendPort": 443,
                            "enableFloatingIP": false,
                            "frontendIPConfiguration": {
                                "id": "[variables('agentLbIPConfigID')]"
                            },
                            "frontendPort": 443,
                            "idleTimeoutInMinutes": 5,
                            "loadDistribution": "Default",
                            "probe": {
                                "id": "[concat(variables('agentLbID'),'/probes/tcp443Probe')]"
                            },
                            "protocol": "Tcp"
                        }
                    },
                    {
                        "name": "LBRule8080",
                        "properties": {
                            "backendAddressPool": {
                                "id": "[concat(variables('agentLbID'), '/backendAddressPools/', variables('agentLbBackendPoolName'))]"
                            },
                            "backendPort": 8080,
                            "enableFloatingIP": false,
                            "frontendIPConfiguration": {
                                "id": "[variables('agentLbIPConfigID')]"
                            },
                            "frontendPort": 8080,
                            "idleTimeoutInMinutes": 5,
                            "loadDistribution": "Default",
                            "probe": {
                                "id": "[concat(variables('agentLbID'),'/probes/tcp8080Probe')]"
                            },
                            "protocol": "Tcp"
                        }
                    }
                ],
                "probes": [
                    {
                        "name": "tcp80Probe",
                        "properties": {
                            "intervalInSeconds": 5,
                            "numberOfProbes": 2,
                            "port": 80,
                            "protocol": "Tcp"
                        }
                    },
                    {
                        "name": "tcp443Probe",
                        "properties": {
                            "intervalInSeconds": 5,
                            "numberOfProbes": 2,
                            "port": 443,
                            "protocol": "Tcp"
                        }
                    },
                    {
                        "name": "tcp8080Probe",
                        "properties": {
                            "intervalInSeconds": 5,
                            "numberOfProbes": 2,
                            "port": 8080,
                            "protocol": "Tcp"
                        }
                    }
                ]
            }
        },
        {
            "apiVersion": "2017-03-30",
            "type": "Microsoft.Compute/virtualMachineScaleSets",
            "dependsOn": [
                "[concat('Microsoft.Network/publicIPAddresses/', variables('masterPublicIPAddressName'))]",
                "[variables('virtualNetworkName')]",
                "[variables('agentLbID')]"
            ],
            "location": "[variables('location')]",
            "name": "[concat(variables('agentVMNamePrefix'), '-vmss')]",
            "properties": {
                "upgradePolicy": {
                    "mode": "Automatic"
                },
                "virtualMachineProfile": {
                    "networkProfile": {
                        "networkInterfaceConfigurations": [
                            {
                                "name": "nic",
                                "properties": {
                                    "ipConfigurations": [
                                        {
                                            "name": "nicipconfig",
                                            "properties": {
                                                "loadBalancerBackendAddressPools": [
                                                    {
                                                        "id": "[concat(variables('agentLbID'), '/backendAddressPools/', variables('agentLbBackendPoolName'))]"
                                                    }
                                                ],
                                                "subnet": {
                                                    "id": "[variables('agentVnetSubnetID')]"
                                                }
                                            }
                                        }
                                    ],
                                    "primary": true
                                }
                            }
                        ]
                    },
                    "osProfile": {
                        "adminUsername": "[variables('adminUsername')]",
                        "computerNamePrefix": "[variables('agentVMNamePrefix')]",
                        "customData": "[base64(concat('#cloud-config\n\nwrite_files:\n -  encoding: gzip\n    content: !!binary |\n        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\n    path: /opt/azure/containers/configure-swarmmode-cluster.sh\n    permissions: \"0744\"\n\n',variables('agentRunCmdFile'),variables('agentRunCmd')))]",
                        "linuxConfiguration": {
                            "disablePasswordAuthentication": true,
                            "ssh": {
                                "publicKeys": [
                                    {
                                        "keyData": "[parameters('sshRSAPublicKey')]",
                                        "path": "[variables('sshKeyPath')]"
                                    }
                                ]
                            }
                        }
                    },
                    "storageProfile": {
                        "imageReference": {
                            "offer": "[variables('osImageOffer')]",
                            "publisher": "[variables('osImagePublisher')]",
                            "sku": "[variables('osImageSKU')]",
                            "version": "latest"
                        },
                        "osDisk": {
                            "caching": "ReadWrite",
                            "createOption": "FromImage",
                            "managedDisk": {
                                "storageAccountType": "[variables('vmSizesMap')[variables('agentVMSize')].diskType]"
                            }
                        }
                    }
                }
            },
            "sku": {
                "capacity": "[variables('agentCount')]",
                "name": "[variables('agentVMSize')]",
                "tier": "Standard"
            },
            "tags": {
                "creationSource": "[concat('acsengine-', variables('agentVMNamePrefix'), '-vmss')]"
            }
        },
        {
            "apiVersion": "2016-03-30",
            "location": "[variables('location')]",
            "name": "[variables('virtualNetworkName')]",
            "properties": {
                "addressSpace": {
                    "addressPrefixes": [
                        "[variables('masterSubnet')]",
                        "[variables('agentSubnet')]"
                    ]
                },
                "subnets": [
                    {
                        "name": "[variables('masterSubnetName')]",
                        "properties": {
                            "addressPrefix": "[variables('masterSubnet')]"
                        }
                    },
                    {
                        "name": "[variables('agentSubnetName')]",
                        "properties": {
                            "addressPrefix": "[variables('agentSubnet')]"
                        }
                    }
                ]
            },
            "type": "Microsoft.Network/virtualNetworks"
        },
        {
            "apiVersion": "2017-03-30",
            "type": "Microsoft.Compute/availabilitySets",
            "location": "[variables('location')]",
            "name": "[variables('masterAvailabilitySet')]",
            "properties": {
                "PlatformUpdateDomainCount": 20,
                "PlatformFaultDomainCount": 2
            },
            "sku": {
                "name": "Aligned"
            }
        },
        {
            "apiVersion": "2016-03-30",
            "location": "[variables('location')]",
            "name": "[variables('masterPublicIPAddressName')]",
            "properties": {
                "dnsSettings": {
                    "domainNameLabel": "[variables('masterEndpointDNSNamePrefix')]"
                },
                "publicIPAllocationMethod": "Dynamic"
            },
            "type": "Microsoft.Network/publicIPAddresses"
        },
        {
            "apiVersion": "2016-03-30",
            "dependsOn": [
                "[concat('Microsoft.Network/publicIPAddresses/', variables('masterPublicIPAddressName'))]"
            ],
            "location": "[variables('location')]",
            "name": "[variables('masterLbName')]",
            "properties": {
                "backendAddressPools": [
                    {
                        "name": "[variables('masterLbBackendPoolName')]"
                    }
                ],
                "frontendIPConfigurations": [
                    {
                        "name": "[variables('masterLbIPConfigName')]",
                        "properties": {
                            "publicIPAddress": {
                                "id": "[resourceId('Microsoft.Network/publicIPAddresses',variables('masterPublicIPAddressName'))]"
                            }
                        }
                    }
                ]
            },
            "type": "Microsoft.Network/loadBalancers"
        },
        {
            "apiVersion": "2019-12-01",
            "copy": {
                "count": "[variables('masterCount')]",
                "name": "masterLbLoopNode"
            },
            "dependsOn": [
                "[variables('masterLbID')]"
            ],
            "location": "[variables('location')]",
            "name": "[concat(variables('masterLbName'), '/', 'SSH-', variables('masterVMNamePrefix'), copyIndex())]",
            "properties": {
                "backendPort": 22,
                "enableFloatingIP": false,
                "frontendIPConfiguration": {
                    "id": "[variables('masterLbIPConfigID')]"
                },
                "frontendPort": "[copyIndex(2200)]",
                "protocol": "Tcp"
            },
            "type": "Microsoft.Network/loadBalancers/inboundNatRules"
        },
        {
            "apiVersion": "2019-12-01",
            "dependsOn": [
                "[variables('masterLbID')]"
            ],
            "location": "[variables('location')]",
            "name": "[concat(variables('masterSshPort22InboundNatRuleNamePrefix'), '0')]",
            "properties": {
                "backendPort": 2222,
                "enableFloatingIP": false,
                "frontendIPConfiguration": {
                    "id": "[variables('masterLbIPConfigID')]"
                },
                "frontendPort": 22,
                "protocol": "Tcp"
            },
            "type": "Microsoft.Network/loadBalancers/inboundNatRules"
        },
        {
            "apiVersion": "2016-03-30",
            "copy": {
                "count": "[variables('masterCount')]",
                "name": "nicLoopNode"
            },
            "dependsOn": [
                "[variables('virtualNetworkName')]",
                "[variables('masterLbID')]",
                "[concat(variables('masterSshPort22InboundNatRuleIdPrefix'),'0')]",
                "[concat(variables('masterSshInboundNatRuleIdPrefix'),copyIndex())]"
            ],
            "location": "[variables('location')]",
            "name": "[concat(variables('masterVMNamePrefix'), 'nic-', copyIndex())]",
            "properties": {
                "ipConfigurations": [
                    {
                        "name": "ipConfigNode",
                        "properties": {
                            "loadBalancerBackendAddressPools": [
                                {
                                    "id": "[concat(variables('masterLbID'), '/backendAddressPools/', variables('masterLbBackendPoolName'))]"
                                }
                            ],
                            "loadBalancerInboundNatRules": "[variables('masterLbInboundNatRules')[copyIndex()]]",
                            "privateIPAddress": "[concat(variables('masterFirstAddrPrefix'), copyIndex(int(variables('masterFirstAddrOctet4'))))]",
                            "privateIPAllocationMethod": "Static",
                            "subnet": {
                                "id": "[variables('masterVnetSubnetID')]"
                            }
                        }
                    }
                ]
            },
            "type": "Microsoft.Network/networkInterfaces"
        },
        {
            "apiVersion": "2017-03-30",
            "type": "Microsoft.Compute/virtualMachines",
            "copy": {
                "count": "[variables('masterCount')]",
                "name": "vmLoopNode"
            },
            "dependsOn": [
                "[concat('Microsoft.Network/networkInterfaces/', variables('masterVMNamePrefix'), 'nic-', copyIndex())]",
                "[concat('Microsoft.Compute/availabilitySets/',variables('masterAvailabilitySet'))]"
            ],
            "location": "[variables('location')]",
            "name": "[concat(variables('masterVMNamePrefix'), copyIndex())]",
            "properties": {
                "availabilitySet": {
                    "id": "[resourceId('Microsoft.Compute/availabilitySets',variables('masterAvailabilitySet'))]"
                },
                "hardwareProfile": {
                    "vmSize": "[variables('masterVMSize')]"
                },
                "networkProfile": {
                    "networkInterfaces": [
                        {
                            "id": "[resourceId('Microsoft.Network/networkInterfaces',concat(variables('masterVMNamePrefix'), 'nic-', copyIndex()))]"
                        }
                    ]
                },
                "osProfile": {
                    "adminUsername": "[variables('adminUsername')]",
                    "computerName": "[concat(variables('masterVMNamePrefix'), copyIndex())]",
                    "customData": "[base64('#cloud-config\n\nwrite_files:\n -  encoding: gzip\n    content: !!binary |\n        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\n    path: /opt/azure/containers/configure-swarmmode-cluster.sh\n    permissions: \"0744\"\n\n')]",
                    "linuxConfiguration": {
                        "disablePasswordAuthentication": true,
                        "ssh": {
                            "publicKeys": [
                                {
                                    "keyData": "[variables('sshRSAPublicKey')]",
                                    "path": "[variables('sshKeyPath')]"
                                }
                            ]
                        }
                    }
                },
                "storageProfile": {
                    "imageReference": {
                        "offer": "[variables('osImageOffer')]",
                        "publisher": "[variables('osImagePublisher')]",
                        "sku": "[variables('osImageSKU')]",
                        "version": "[variables('osImageVersion')]"
                    },
                    "osDisk": {
                        "name": "[concat(variables('masterVMNamePrefix'), copyIndex(),'_OSDisk')]",
                        "caching": "ReadWrite",
                        "createOption": "FromImage",
                        "managedDisk": {
                            "storageAccountType": "[variables('vmSizesMap')[variables('masterVMSize')].diskType]"
                        }
                    }
                }
            },
            "tags": {
                "creationSource": "[concat('acsengine-', variables('masterVMNamePrefix'), copyIndex())]"
            }
        },
        {
            "apiVersion": "2016-03-30",
            "type": "Microsoft.Compute/virtualMachines/extensions",
            "copy": {
                "count": "[variables('masterCount')]",
                "name": "vmLoopNode"
            },
            "dependsOn": [
                "[concat('Microsoft.Compute/virtualMachines/', concat(variables('masterVMNamePrefix'), copyIndex()))]"
            ],
            "location": "[variables('location')]",
            "name": "[concat(variables('masterVMNamePrefix'), copyIndex(), '/configuremaster')]",
            "properties": {
                "publisher": "Microsoft.OSTCExtensions",
                "settings": {
                    "commandToExecute": "[variables('masterCustomScript')]",
                    "fileUris": []
                },
                "type": "CustomScriptForLinux",
                "typeHandlerVersion": "1.4",
                "autoUpgradeMinorVersion": true,
                "protectedSettings": {
                    "commandToExecute": ""
                }
            }
        }
    ],
    "outputs": {
        "agentFQDN": {
            "type": "string",
            "value": "[reference(concat('Microsoft.Network/publicIPAddresses/', variables('agentIPAddressName'))).dnsSettings.fqdn]"
        },
        "masterFQDN": {
            "type": "string",
            "value": "[reference(concat('Microsoft.Network/publicIPAddresses/', variables('masterPublicIPAddressName'))).dnsSettings.fqdn]"
        }
    }
};

suite("Functional parameter file completions", () => {

    function createCompletionsFunctionalTest(
        testName: string,
        params: string | Partial<IDeploymentParametersFile>,
        template: string | Partial<IDeploymentTemplate> | undefined,
        insertSuggestionPrefix: string, // Insert the suggestion starting with this string
        expectedResult: string
    ): void {
        testWithLanguageServer(testName, async () => {
            let editor: TempEditor | undefined;
            let templateFile: TempFile | undefined;

            try {
                const { markers: { bang }, unmarkedText } = getDocumentMarkers(params);
                expectedResult = removeEOLMarker(expectedResult);

                // Create template/params files
                if (template) {
                    templateFile = new TempFile(stringify(template));
                }
                let paramsFile = new TempFile(unmarkedText);

                // Map template to params
                if (templateFile) {
                    await ext.deploymentFileMapping.getValue().mapParameterFile(templateFile.uri, paramsFile.uri);
                }

                // Open params in editor
                const paramsDoc = new TempDocument(paramsFile);
                editor = new TempEditor(paramsDoc);
                await editor.open();

                // Move cursor to the "!" in the document
                const position = editor.document.realDocument.positionAt(bang.index);
                editor.realEditor.selection = new Selection(position, position);
                await delay(1);

                // Trigger completion UI
                const completionItemsPromise = getCompletionItemsPromise(paramsDoc.realDocument);
                await commands.executeCommand('editor.action.triggerSuggest');

                // Wait for our code to return completion items
                let items = await completionItemsPromise;
                items = items;

                // Wait for any resolution to be sure the UI is ready
                const resolutionPromise = getCompletionItemResolutionPromise();
                await delay(1);
                let currentItem = await resolutionPromise;

                // Select the item we want and accept it
                let tries = 0;
                while (true) {
                    if (tries++ > 100) {
                        assert.fail(`Did not find a completion item starting with "${insertSuggestionPrefix}"`);
                    }

                    if (currentItem.label.startsWith(insertSuggestionPrefix)) {
                        break;
                    }

                    const resolutionPromise2 = getCompletionItemResolutionPromise();
                    await commands.executeCommand('selectNextSuggestion');
                    await delay(1);
                    currentItem = await resolutionPromise2;
                }

                const documentChangedPromise = getDocumentChangedPromise(paramsDoc.realDocument);
                await commands.executeCommand('acceptSelectedSuggestion');

                // Wait for it to get inserted
                await documentChangedPromise;

                // Some completions have additional text edits, and vscode doesn't
                // seem to have made all the changes when it fires didDocumentChange,
                // so give a slight delay to allow it to finish
                await delay(1);

                const actualResult = paramsDoc.realDocument.getText();
                assert.equal(actualResult, expectedResult);
            } finally {
                if (editor) {
                    await editor.dispose();
                }
                if (templateFile) {
                    await ext.deploymentFileMapping.getValue().mapParameterFile(templateFile.uri, undefined);
                }
            }
        });
    }

    suite("Completions for new parameters", async () => {
        createCompletionsFunctionalTest(
            "No template file, new parameter in blank section",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        !{EOL}
    }
}`,
            undefined,
            newParamCompletionLabel,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "parameter1": {
            "value": "value"
        }
    }
}`
        );

        createCompletionsFunctionalTest(
            "No template file, new parameter after an existing one, comma already exists",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "PARAmeter2": {
            "value": "string"
        },
        !{EOL}
    }
}`,
            undefined,
            newParamCompletionLabel,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "PARAmeter2": {
            "value": "string"
        },
        "parameter1": {
            "value": "value"
        }
    }
}`
        );

        createCompletionsFunctionalTest(
            "No template file, new parameter after an existing one, automatically add comma after old param",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "PARAmeter2": {
            "value": "string"
        }
        !{EOL}
    }
}`,
            undefined,
            newParamCompletionLabel,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "PARAmeter2": {
            "value": "string"
        },
        "parameter1": {
            "value": "value"
        }
    }
}`
        );

        createCompletionsFunctionalTest(
            "No template file, new parameter after an existing one, automatically add comma after old param - has comments",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "PARAmeter2": {
            "value": "string"
        }
        // some comments
        !{EOL}
    }
}`,
            undefined,
            newParamCompletionLabel,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "PARAmeter2": {
            "value": "string"
        },
        // some comments
        "parameter1": {
            "value": "value"
        }
    }
}`
        );

        createCompletionsFunctionalTest(
            "No template file, new parameter before an existing one, automatically adds comma after new parameter",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        !{EOL}
        "PARAmeter2": {
            "value": "string"
        }
    }
}`,
            undefined,
            newParamCompletionLabel,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "parameter1": {
            "value": "value"
        },
        "PARAmeter2": {
            "value": "string"
        }
    }
}`
        );

        createCompletionsFunctionalTest(
            "No template file, inside existing double quotes (or double quote trigger), removes double quotes when inserting",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "!"
    }
}`,
            undefined,
            newParamCompletionLabel,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "parameter1": {
            "value": "value"
        }
    }
}`
        );

        createCompletionsFunctionalTest(
            "Template file one required param, new parameter in blank section",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        !{EOL}
    }
}`,
            defaultTemplate,
            newParamCompletionLabel,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "parameter1": {
            "value": "value"
        }
    }
}`
        );
    });

    suite("Completions for parameters in template file", async () => {
        createCompletionsFunctionalTest(
            "From required parameter",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        !{EOL}
    }
}`,
            defaultTemplate,
            `"required1"`,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "required1": {
            "value": "" // TODO: Fill in parameter value
        }
    }
}`
        );

        createCompletionsFunctionalTest(
            "From optional parameter",
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "required1": {
            "value": "abc"
        },
        !{EOL}
        "required2": {
            "value": "abc"
        }
    }
}`,
            defaultTemplate,
            `"optional1"`,
            `{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "required1": {
            "value": "abc"
        },
        "optional1": {
            "value": {
              "abc": "def"
            }
        },
        "required2": {
            "value": "abc"
        }
    }
}`
        );

    });

    createCompletionsFunctionalTest(
        "From optional parameter, no existing comma",
        `{
"$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
"contentVersion": "1.0.0.0",
"parameters": {
    "required1": {
        "value": "abc"
    }
    !{EOL}
    "required2": {
        "value": "abc"
    }
}
}`,
        defaultTemplate,
        `"optional1"`,
        `{
"$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
"contentVersion": "1.0.0.0",
"parameters": {
    "required1": {
        "value": "abc"
    },
    "optional1": {
        "value": {
          "abc": "def"
        }
    },
    "required2": {
        "value": "abc"
    }
}
}`
    );
});
