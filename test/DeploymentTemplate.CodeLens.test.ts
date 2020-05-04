// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

// tslint:disable:no-unused-expression max-func-body-length promise-function-async max-line-length insecure-random
// tslint:disable:object-literal-key-quotes no-function-expression no-non-null-assertion align no-http-string

import * as assert from "assert";
import { Position, Range, Uri } from "vscode";
import { IDeploymentTemplate } from "./support/diagnostics";
import { parseParametersWithMarkers, parseTemplate } from "./support/parseTemplate";
import { stringify } from "./support/stringify";

suite("DeploymentTemplate code lens", () => {
    const template: IDeploymentTemplate = {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {
            "requiredInt": {
                "type": "int"
            },
            "optionalInt": {
                "type": "int",
                "defaultValue": 123
            },

            "requiredString": {
                "type": "string"
            },
            "optionalString": {
                "type": "string",
                "defaultValue": "abc"
            },
            "optionalString2": {
                "type": "string",
                "defaultValue": "[parameters('optionalString')]"
            },

            "requiredSecureString": {
                "type": "securestring"
            },
            "optionalSecureString": {
                "type": "securestring",
                "defaultValue": "abc"
            },

            "requiredBool": {
                "type": "bool"
            },
            "optionalBool": {
                "type": "bool",
                "defaultValue": true
            },

            "requiredArray": {
                "type": "array"
            },
            "optionalArray": {
                "type": "array",
                "defaultValue": [
                    true
                ]
            },

            "requiredObject": {
                "type": "object"
            },
            "optionalObject": {
                "type": "object",
                "defaultValue": {
                    "myTrueProp": true
                }
            },

            "requiredSecureObject": {
                "type": "secureObject"
            },
            "optionalSecureObject": {
                "type": "secureObject",
                "defaultValue": {
                    "value1": true
                }
            }

        },
        "functions": [
        ],
        "variables": {
        },
        "resources": [
        ],
        "outputs": {
            "output1": {
                "type": "array",
                "value": [
                    "[add(parameters('optionalInt'),parameters('requiredInt'))]",
                    "[concat(parameters('optionalString'),parameters('optionalString2'),parameters('requiredString'))]",
                    "[concat(parameters('optionalBool'),parameters('requiredBool'))]",
                    "[concat(parameters('optionalArray'),parameters('requiredArray'))]",
                    "[concat(parameters('optionalObject'),parameters('requiredObject'))]",
                    "[concat(parameters('optionalSecureObject'),parameters('requiredSecureObject'))]",
                    "[concat(parameters('optionalSecureString'),parameters('requiredSecureString'))]"
                ]
            }
        }
    };

    suite("parameters section code lens", () => {
        suite("if no parameter file then", () => {
            test("expect only a single parameters section code lens", async () => {
                const dt = await parseTemplate(template);
                const lenses = dt.getCodeLenses(false);
                assert.equal(lenses.length, 1, "Expecting only a code lens for the parameters section itself");
            });

            test("code lens should show command to select/create one", async () => {
                const dt = await parseTemplate(template);
                const lenses = dt.getCodeLenses(false);
                lenses.forEach(lens => lens.resolve(undefined));
                assert.equal(stringify(lenses[0].range), stringify(new Range(new Position(3, 2), new Position(63, 3))));
                assert.equal(lenses[0].command?.title, "Select or create a parameter file to enable full validation...");
                assert.equal(lenses[0].command?.command, "azurerm-vscode-tools.selectParameterFile");
                assert.equal(lenses[0].command?.arguments?.length, 1);
                assert(lenses[0].command?.arguments![0] instanceof Uri);
                assert.equal(lenses[0].command?.arguments[0].toString(), dt.documentId.toString());
            });
        });

        suite("if there is a parameter file then", () => {
            test("parameter section code lens should show command to open current parameter file and one to change the selection", async () => {
                const dt = await parseTemplate(template);
                const { dp } = await parseParametersWithMarkers({});
                const lenses = dt.getCodeLenses(true);
                assert.equal(lenses.length, 2 + dt.topLevelScope.parameterDefinitions.length);
                lenses.forEach(lens => lens.resolve(dp));

                const openLens = lenses[0];
                assert.equal(stringify(openLens.range), stringify(new Range(new Position(3, 2), new Position(63, 3))));
                assert.equal(openLens.command?.title, `Parameter file: "test parameter file.json"`);
                assert.equal(openLens.command?.command, "azurerm-vscode-tools.openParameterFile");
                assert.equal(openLens.command?.arguments?.length, 1);
                assert(openLens.command?.arguments![0] instanceof Uri);
                assert.equal(openLens.command?.arguments[0].toString(), dt.documentId.toString());

                const selectLens = lenses[1];
                assert.equal(stringify(selectLens.range), stringify(new Range(new Position(3, 2), new Position(63, 3))));
                assert.equal(selectLens.command?.title, `Select parameter file...`);
                assert.equal(selectLens.command?.command, "azurerm-vscode-tools.selectParameterFile");
                assert.equal(selectLens.command?.arguments?.length, 1);
                assert(selectLens.command?.arguments![0] instanceof Uri);
                assert.equal(selectLens.command?.arguments[0].toString(), dt.documentId.toString());
            });
        });
    });
});
