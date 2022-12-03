// ==UserScript==
// @name         DBS on Steroids
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  Putting the editor of the TU Vienna databases website on steroids
// @author       Stefnotch
// @match        https://gordon.dbai.tuwien.ac.at/*
// @updateURL    https://github.com/stefnotch/dbs-editor/script.js
// @downloadURL  https://github.com/stefnotch/dbs-editor/script.js
// @grant GM_addStyle
// ==/UserScript==

(function () {
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
    border-left: 1px solid #aaa;
    border-right: 1px solid #aaa;
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

/* Make horizontal scrollbar, decorations overview ruler and vertical scrollbar arrows opaque */
.monaco-editor .monaco-scrollable-element .scrollbar.horizontal,
.monaco-editor .decorationsOverviewRuler,
.monaco-editor .monaco-scrollable-element .scrollbar.vertical .arrow-background {
	background: rgba(230, 230, 230, 255);
}
/* Make vertical scrollbar transparent to allow decorations overview ruler to be visible */
.monaco-editor .monaco-scrollable-element .scrollbar.vertical {
	background: rgba(0, 0, 0, 0);
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
        const inputElement = formElement.querySelector("#queryInput");
        assert(inputElement, "Missing input element");

        // On form submit do not reload the page and instead load the result table
        const replaceResultTable = (newResults) => {
            const existingOutputs = getOutputs(formElement);
            existingOutputs.forEach(v => v.remove());
            const tr = getContainerTr(formElement);
            tr.after(...newResults);
        };
        const url = formElement.action;
        assert(url, "Invalid form element");
        let getUserInput = () => { return inputElement.value; };
        const onSubmit = async () => {
            getOutputs(formElement).forEach(v => v.style.opacity = "0.5"); // Loading
            inputElement.value = getUserInput();
            const newResultTable = await fetchResultTable(url, formElement);
            replaceResultTable(newResultTable);
        };

        window.addEventListener('beforeunload', (event) => {
            const hasChanged = inputElement.value != getUserInput();
            if (hasChanged) {
                event.preventDefault();
                return event.returnValue = "Are you sure you want to exit?";
            }
        });

        // Load Monaco. We are using a CDN.
        const scriptDirectory = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/';

        loadScript(scriptDirectory + "min/vs/loader.js", () => {
            require.config({ paths: { vs: scriptDirectory + 'min/vs' } });
            require(['vs/editor/editor.main'], function () {
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
                getUserInput = () => {
                    return editor.getValue() ?? "";
                }
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                    onSubmit();
                });

                makeSqlCompletions(editor);

                makeResizeable(editor, container);

                toggleEditorDisplay = () => {
                    container.style.display = isEditorEnabled() ? "block" : "none";
                    inputElement.style.display = isEditorEnabled() ? "none" : "block";
                }
            });
        });

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

        return getOutputs(resultForm);
    }

    function getContainerTr(formElement) {
        const inputElement = formElement.querySelector("#queryInput");
        const tr = topmostParentWithTagName(inputElement, "tr", formElement);
        assert(tr, "Missing table row");
        return tr;
    }

    function getOutputs(formElement) {
        const tr = getContainerTr(formElement);

        const elements = [];
        let current = tr.nextElementSibling;
        while (current) {
            elements.push(current);
            current = current.nextElementSibling;
        }
        return elements;
    }

    function makeSqlCompletions(editor) {
        monaco.languages.registerCompletionItemProvider('sql', {
            provideCompletionItems: () => {
                const sqlKeywords = ["select", "from", "where", "group by", "order by", "distinct", "having", "inner join", "outer join", "left join", "right join", "count", "and", "on", "not", "sum", "avg", "max", "min", "coalesce", "like", "desc", "asc"];
                const suggestions = [];
                sqlKeywords.forEach(v => {
                    suggestions.push({
                        label: v,
                        kind: monaco.languages.CompletionItemKind.Keyword,
                        insertText: v
                    });
                });

                return { suggestions: suggestions };
            }
        });
    }

    function topmostParentWithTagName(element, tagName, container) {
        tagName = tagName.toLowerCase();
        const parents = [];
        while (element != null && element != container) {
            if (element.tagName.toLowerCase() == tagName) {
                parents.push(element);
            }
            element = element.parentElement;
        }
        return parents[parents.length - 1];
    }

    function assert(condition, msg) {
        if (!condition) {
            throw new Error(msg);
        }
    }

    function loadScript(url, callback) {
        const script = document.createElement("script");
        script.onload = () => {
          callback();
        };
        script.src = url;
        document.head.appendChild(script);
    }

    initEditor();
})();
