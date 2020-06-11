// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import { CodeAction, Range, Selection } from "vscode";
import { CodeActionContext, Command } from "vscode-languageclient";
import { DeploymentTemplate } from "../DeploymentTemplate";
import { IParameterDefinition } from "../IParameterDefinition";
import { IParameterValues } from "./IParameterValues";

// /** asdf
//  * Represents a "parameters" object in a deployment template or parameter file
//  * which contains parameter values (not definitions) for a template file or
//  * linked/nested template
//  */
// export class ParameterValues extends IParameterValues {
//     public getParameterValue(parameterName: string): ParameterValueDefinition | undefined;
//     public parameterValuesDefiniitions: ParameterValueDefinition[];

//     public parametersProperty: Json.Property | undefined;
//     public parametersObjectValue: Json.ObjectValue | undefined;
// }

// tslint:disable-next-line: export-name asdf
export async function getParameterValuesCodeActions(
    parameterValues: IParameterValues,
    deploymentTemplate: DeploymentTemplate | undefined, //asdf interface?  scope?
    range: Range | Selection,
    context: CodeActionContext
): Promise<(Command | CodeAction)[]> {
    //asdf const template: DeploymentTemplate | undefined = <DeploymentTemplate | undefined>associatedDocument;

    const actions: (Command | CodeAction)[] = [];
    const parametersProperty = parameterValues.parametersProperty;

    if (parametersProperty) {
        const lineIndex = this.getDocumentPosition(parametersProperty?.nameValue.span.startIndex).line;
        if (lineIndex >= range.start.line && lineIndex <= range.end.line) {
            const missingParameters: IParameterDefinition[] = this.getMissingParameters(template, false);

            // Add missing required parameters
            if (missingParameters.some(p => this.isParameterRequired(p))) {
                const action = new CodeAction("Add missing required parameters", CodeActionKind.QuickFix);
                action.command = {
                    command: 'azurerm-vscode-tools.codeAction.addMissingRequiredParameters',
                    title: action.title,
                    arguments: [
                        this.documentUri
                    ]
                };
                actions.push(action);
            }

            // Add all missing parameters
            if (missingParameters.length > 0) {
                const action = new CodeAction("Add all missing parameters", CodeActionKind.QuickFix);
                action.command = {
                    command: 'azurerm-vscode-tools.codeAction.addAllMissingParameters',
                    title: action.title,
                    arguments: [
                        this.documentUri
                    ]
                };
                actions.push(action);
            }
        }
    }

    return actions;
}

function isParameterRequired(paramDef: IParameterDefinition): boolean {
    return !paramDef.defaultValue;
}

function getMissingParameters(
    parameterDefinitions: IParameterDefinition[],
    parameterValues: IParameterValues,
    onlyRequiredParameters: boolean
): IParameterDefinition[] {
    const results: IParameterDefinition[] = [];
    for (let paramDef of parameterDefinitions) {
        const paramValue = parameterValues.getParameterValue(paramDef.nameValue.unquotedValue);
        if (!paramValue) {
            results.push(paramDef);
        }
    }

    if (onlyRequiredParameters) {
        return results.filter(isParameterRequired);
    }

    return results;
}
