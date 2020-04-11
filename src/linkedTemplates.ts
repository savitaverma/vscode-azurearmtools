// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import * as path from 'path';
import { ProgressLocation, Uri, window, workspace } from "vscode";
import { callWithTelemetryAndErrorHandling, parseError } from "vscode-azureextensionui";
import { ext } from "./extensionVariables";
import { assert } from './fixed_assert';

/**
 * Handles a request from the language server to open a linked template
 * @param sourceTemplateUri The full URI of the template which contains the link
 * @param requestedLinkPath The full URI of the resolved link being requested
 */
export async function onRequestOpenLinkedFile(sourceTemplateUri: string, _requestedLinkUri: string, requestedLinkResolvedUri: string): Promise<string | undefined> {
    //asdf what return?
    try {
        await callWithTelemetryAndErrorHandling('onRequetOpenLinkedFile', async () => { //asdf error handling
            const sourceTemplatePathAsUri: Uri = Uri.parse(sourceTemplateUri, true); //asdf? what if not file:// ?
            const requestedLinkPathAsUri: Uri = Uri.parse(requestedLinkResolvedUri, true); //asdf? what if not file:// ?

            assert(path.isAbsolute(sourceTemplatePathAsUri.fsPath), "Internal error: sourceTemplateUri should be an absolute path");
            assert(path.isAbsolute(requestedLinkPathAsUri.fsPath), "Internal error: requestedLinkUri should be an absolute path");

            ext.outputChannel.appendLine(`Opening linked file "${requestedLinkResolvedUri}" (linked from "${path.basename(sourceTemplatePathAsUri.fsPath)}")`);

            //asdf what if get multiple requests immediately?  do we care?
            // tslint:disable-next-line: no-floating-promises // Don't wait
            await tryLoadLinkedFile(requestedLinkPathAsUri);
        });

        return undefined;
    } catch (err) {
        return parseError(err).message; //asdf?
    }
}

// asdf what if file can't be loaded?  When do we try again?

/**
 * Attempts to load the given file into a text document in VS Code so that
 * it will get sent to the language server.
 */
export async function tryLoadLinkedFile(uri: Uri): Promise<void> {
    //asdf
    //await callWithTelemetryAndErrorHandling('tryLoadLinkedFile', async (actionContext: IActionContext) => { //asdf error handling
    try {
        // Note: If the URI is already opened, returns the existing document
        await window.withProgress(
            {
                location: ProgressLocation.Window,
                title: `Loading linked file ${uri.fsPath}`
            },
            async () => {
                await workspace.openTextDocument(uri);
            });
        //asdf What if it's JSON?  Will auto language switch kick in?
    } catch (err) {
        throw new Error(parseError(err).message); //asdf what UI experience? put in error list?  asdf wrap error
    }
    //});
}
