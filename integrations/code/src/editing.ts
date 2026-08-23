/*
 * Copyright (c) 2026 Zensical and contributors
 *
 * SPDX-License-Identifier: MIT
 * All contributions are certified under the DCO
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import * as vscode from "vscode";
import type { ExtensionContext, Range, TextDocument, TextEditor } from "vscode";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Edit that toggles bold formatting for a selection.
 */
interface BoldEdit {
  range: Range;
  start: number;
  end: number;
  text: string;
  innerOffset: number;
  innerLength: number;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Register editing commands for the extension.
 *
 * @param context - The extension context
 */
export function registerEditingCommands(context: ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zensicalStudio.toggleBold",
      () => toggleBold(vscode.window.activeTextEditor),
    ),
  );
}

/**
 * Toggle bold formatting for all selections in the editor.
 *
 * @param editor - Active text editor
 */
async function toggleBold(editor: TextEditor | undefined): Promise<void> {
  if (
    typeof editor === "undefined" ||
    editor.document.isClosed ||
    editor.document.languageId !== "python-markdown"
  ) {
    return;
  }

  // Compute an edit for each selection, expanding empty selections to the
  // word under the cursor, inserting empty markers when there is no word to
  // toggle, and drop overlapping selections
  const edits = editor.selections
    .map((selection) => {
      if (selection.isEmpty) {
        const word = editor.document.getWordRangeAtPosition(selection.active);
        if (typeof word !== "undefined") {
          return toggleEdit(editor.document, word);
        }
        return emptyBoldEdit(editor.document, selection.active);
      }
      return toggleEdit(editor.document, selection);
    })
    .sort((a, b) => a.start - b.start)
    .filter((edit, index, all) =>
      index === 0 || edit.start >= all[index - 1].end,
    );
  if (edits.length === 0) {
    return;
  }

  // Apply all edits in a single transaction, so that toggling the formatting
  // of all selections can be undone in one step
  try {
    const applied = await editor.edit((builder) => {
      for (const edit of edits) {
        builder.replace(edit.range, edit.text);
      }
    });
    if (!applied) {
      return;
    }
  } catch {
    return;
  }

  // Select the text without the markers, mirroring the original selection
  let delta = 0;
  editor.selections = edits.map((edit) => {
    const start = edit.start + delta;
    const from = editor.document.positionAt(start + edit.innerOffset);
    const to = editor.document.positionAt(
      start + edit.innerOffset + edit.innerLength,
    );
    delta += edit.text.length - (edit.end - edit.start);
    return new vscode.Selection(from, to);
  });
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Compute the edit that toggles bold formatting for a range.
 *
 * @param document - Text document
 * @param range - Range to toggle
 *
 * @returns Bold toggle edit
 */
function toggleEdit(document: TextDocument, range: Range): BoldEdit {
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);
  const selected = document.getText(range);
  const text = document.getText();

  // Remove markers that are part of the selection itself
  const stripped = stripMarkers(selected);
  if (typeof stripped !== "undefined") {
    return {
      range,
      start,
      end,
      text: stripped,
      innerOffset: 0,
      innerLength: stripped.length,
    };
  }

  // Remove markers surrounding the selection
  const before = text.slice(Math.max(0, start - 2), start);
  const after = text.slice(end, end + 2);
  if (before === after && (before === "**" || before === "__")) {
    return {
      range: new vscode.Range(
        document.positionAt(start - 2),
        document.positionAt(end + 2),
      ),
      start: start - 2,
      end: end + 2,
      text: selected,
      innerOffset: 0,
      innerLength: selected.length,
    };
  }

  // Wrap the selection in bold markers
  return {
    range,
    start,
    end,
    text: `**${selected}**`,
    innerOffset: 2,
    innerLength: selected.length,
  };
}

/**
 * Compute the edit that toggles bold formatting at a position.
 *
 * @param document - Text document
 * @param position - Position to toggle
 *
 * @returns Bold toggle edit
 */
function emptyBoldEdit(
  document: TextDocument, position: vscode.Position,
): BoldEdit {
  const offset = document.offsetAt(position);
  const text = document.getText();
  const before = text.slice(Math.max(0, offset - 2), offset);
  const after = text.slice(offset, offset + 2);

  // Remove markers if the cursor sits between an empty pair of markers
  if (before === after && (before === "**" || before === "__")) {
    return {
      range: new vscode.Range(
        document.positionAt(offset - 2),
        document.positionAt(offset + 2),
      ),
      start: offset - 2,
      end: offset + 2,
      text: "",
      innerOffset: 0,
      innerLength: 0,
    };
  }

  // Insert an empty pair of markers with the cursor between them
  return {
    range: new vscode.Range(position, position),
    start: offset,
    end: offset,
    text: "****",
    innerOffset: 2,
    innerLength: 0,
  };
}

/**
 * Remove bold markers from the start and end of a string.
 *
 * @param text - Text to strip
 *
 * @returns Stripped text, or undefined if no markers were found
 */
function stripMarkers(text: string): string | undefined {
  for (const marker of ["**", "__"]) {
    if (
      text.length > marker.length * 2 &&
      text.startsWith(marker) &&
      text.endsWith(marker)
    ) {
      return text.slice(marker.length, -marker.length);
    }
  }
  return undefined;
}
