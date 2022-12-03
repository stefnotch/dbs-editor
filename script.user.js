// ==UserScript==
// @name         DBS on Steroids
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Putting the editor of the TU Vienna databases website on steroids
// @author       Stefnotch
// @match        https://gordon.dbai.tuwien.ac.at/*
// @updateURL    https://github.com/stefnotch/dbs-editor/script.js
// @downloadURL  https://github.com/stefnotch/dbs-editor/script.js
// @require https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/min/vs/loader.js
// @grant GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(`
.btn {
    border-radius: 4px;
    border: 1px solid black;
    background-color: white;
}

.btn:hover {
    border: 1px solid #eeeeee;
    background-color: #eeeeee;
}

.editor-container {
    position: relative;
    margin-bottom: 8px;
}

.editor-container::after  {
    content: '';
    background-color: #aaaaaa;
    position: absolute;
    bottom: 0px;
    height: 4px;
    margin-bottom: -4px;
    width: 100%;
    cursor: ns-resize;
}
`);

    const LocalStorageKey = "advanced-editor";


    function isEditorEnabled() {
        return localStorage.getItem(LocalStorageKey) !== "false";
    }

    function toggleEditor() {
        const enabled = isEditorEnabled();
        localStorage.setItem(LocalStorageKey, enabled ? "false" : "true");
        toggleEditorDisplay();
    }

    let toggleEditorDisplay = () => {
        const enabled = isEditorEnabled();
        if (!enabled) {
            // Nothing to do, default editor is good
            return;
        } else {
            initEditor();
        }
    };

    async function initEditor() {
        if (!isEditorEnabled()) return;

        const formElement = document.querySelector("#queryForm");
        if (!formElement) return;

        // On form submit do not reload the page and instead load the result table
        const replaceResultTable = (newResultTable) => {
            const existingTable = getTable(formElement);
            assert(existingTable, "Missing table");
            existingTable.replaceWith(newResultTable);
        };
        const url = formElement.action;
        assert(url, "Invalid form element");
        let loadUserInput = () => { };
        const onSubmit = async () => {
            getTable(formElement).style.opacity = "0.5"; // Loading
            loadUserInput();
            const newResultTable = await fetchResultTable(url, formElement);
            replaceResultTable(newResultTable);
        };

        // Load Monaco. We are using a CDN.
        const scriptDirectory = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/'
        (() => {
            require.config({ paths: { vs: scriptDirectory + 'min/vs' } });
            require(['vs/editor/editor.main'], function () {
                const inputElement = formElement.querySelector("#queryInput");
                assert(inputElement, "Missing input element");
                inputElement.style.display = "none";
                const container = document.createElement("div");
                container.classList.add("editor-container");
                container.style.width = "60em";
                container.style.height = "15em";
                inputElement.after(container);
                const editor = monaco.editor.create(container, {
                    value: inputElement.value,
                    language: 'sql',
                    minimap: {
                        enabled: false
                    }
                });
                loadUserInput = () => {
                    inputElement.value = editor.getValue() ?? "";
                }
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                    onSubmit();
                });

                makeResizeable(editor, container);

                toggleEditorDisplay = () => {
                    container.style.display = isEditorEnabled() ? "block" : "none";
                    inputElement.style.display = isEditorEnabled() ? "none" : "block";
                }
            });
        })();

        // Replace form submit
        formElement.addEventListener("submit", async (event) => {
            event.preventDefault();
            onSubmit();
        });
    }

    // Thank you to https://stackoverflow.com/a/53220241/3492994
    function makeResizeable(editor, container) {
        const BORDER_SIZE = 10;
        let m_pos;
        function resize(e) {
            const dy = - (m_pos - e.y);
            m_pos = e.y;
            container.style.height = (parseInt(getComputedStyle(container, '').height, 10) + dy) + "px";
            editor.layout();
        }

        container.addEventListener("pointerdown", (e) => {
            const height = container.getBoundingClientRect().height;
            if (Math.abs(height - e.offsetY) < BORDER_SIZE) {
                m_pos = e.y;
                document.addEventListener("pointermove", resize, false);
            }
        }, false);

        document.addEventListener("pointerup", () => {
            document.removeEventListener("pointermove", resize, false);
        }, false);
    }

    async function fetchResultTable(url, formElement) {
        const data = new URLSearchParams(new FormData(formElement));
        const responseDocument = await fetch(url, {
            method: 'post',
            body: data,
        }).then(response => response.text())
        .then(text => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");
            return doc;
        });
        if (!responseDocument) {
            console.error("Failed to load response document");
            return null;
        }
        const resultForm = responseDocument.querySelector("#queryForm");
        if (!resultForm) {
            console.error("Failed to load response form", responseDocument);
            return null;
        }

        const resultTable = getTable(resultForm);
        return resultTable;
    }

    function getTable(formElement) {
        const table = formElement.querySelector("#messageBox") || formElement.querySelector(".resultTable");
        assert(table, "Missing table");
        return table;
    }

    function assert(condition, msg) {
        if (!condition) {
            throw new Error(msg);
        }
    }

    initEditor();
})();
