// extension.js - Main extension file
const vscode = require('vscode');
const { JSDOM } = require('jsdom');

let domTreePanel = null;
let currentEditor = null;
let currentHtmlContent = null;

function activate(context) {
    console.log('DOM Tree Extension is now active!');

    // Register command to open DOM tree
    const disposable = vscode.commands.registerCommand('domTree.openTree', () => {
        createOrShowDOMTree(context);
    });

    // Listen for active editor changes
    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((newEditor) => {
        if (domTreePanel && newEditor && newEditor.document.languageId === 'html') {
            // Update stored editor and content when switching to a different HTML file
            currentEditor = newEditor;
            currentHtmlContent = newEditor.document.getText();
            updateDOMTree();
        }
    });

    // Listen for document changes
    const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        if (domTreePanel && currentEditor && event.document === currentEditor.document) {
            // Update stored content
            currentHtmlContent = event.document.getText();
            // Debounce updates
            clearTimeout(updateDOMTree.timeout);
            updateDOMTree.timeout = setTimeout(() => {
                updateDOMTree();
            }, 500);
        }
    });

    context.subscriptions.push(disposable, editorChangeDisposable, documentChangeDisposable);
}

function createOrShowDOMTree(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document || editor.document.languageId !== 'html') {
        vscode.window.showErrorMessage('Please open an HTML file and place the cursor inside it.');
        return;
    }

    // Store the current editor and content
    currentEditor = editor;
    currentHtmlContent = editor.document.getText();

    const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

    if (domTreePanel) {
        // If panel already exists, just show it
        domTreePanel.reveal(columnToShowIn);
        updateDOMTree();
        return;
    }

    // Create new panel
    domTreePanel = vscode.window.createWebviewPanel(
        'domTree',
        'DOM Tree',
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Handle messages from webview
    domTreePanel.webview.onDidReceiveMessage(
        message => {
            switch (message.command) {
                case 'jumpToLine':
                    jumpToLine(message.line);
                    break;
                case 'ready':
                    updateDOMTree();
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    // Clean up when panel is closed
    domTreePanel.onDidDispose(() => {
        domTreePanel = null;
        currentEditor = null;
        currentHtmlContent = null;
    }, null, context.subscriptions);

    // Initial update
    updateDOMTree();
}

function updateDOMTree() {
    if (!domTreePanel) return;

    // Use stored editor if available, otherwise fall back to active editor
    const editor = currentEditor || vscode.window.activeTextEditor;
    if (!editor) {
        domTreePanel.webview.html = getWebviewContent('No active editor');
        return;
    }

    const document = editor.document;
    const isHTML = document.languageId === 'html' || document.fileName.endsWith('.html');
    
    if (!isHTML) {
        domTreePanel.webview.html = getWebviewContent('Not an HTML file');
        return;
    }

    try {
        // Use stored content if available, otherwise get current content
        const htmlContent = currentHtmlContent || document.getText();
        const dom = new JSDOM(htmlContent);
        const root = dom.window.document.documentElement;
        const asciiTree = renderAsciiTree(root);
        domTreePanel.webview.html = getWebviewContent(asciiTree);
    } catch (error) {
        domTreePanel.webview.html = getWebviewContent(`Error: ${error.message}`);
    }
}

// Recursive DOM to ASCII rendering with interactive elements
function renderAsciiTree(node, prefix = '', isLast = true, nodeId = '0') {
    if (node.nodeType !== 1) return '';
    
    const tagName = node.tagName.toLowerCase();
    const connector = isLast ? '└── ' : '├── ';
    const attrText = getAttributeString(node);
    const childCount = node.children.length;
    const countInfo = childCount > 0 ? ` (${childCount} child${childCount > 1 ? 'ren' : ''})` : '';
    const hasChildren = childCount > 0;
    
    // Create the tree node data
    const nodeData = {
        id: nodeId,
        prefix: prefix,
        connector: connector,
        tagName: tagName,
        attrText: attrText,
        countInfo: countInfo,
        hasChildren: hasChildren,
        children: []
    };
    
    // Process children
    if (hasChildren) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        Array.from(node.children).forEach((child, i, arr) => {
            const childNodeId = `${nodeId}_${i}`;
            const childTree = renderAsciiTree(child, newPrefix, i === arr.length - 1, childNodeId);
            if (childTree) {
                nodeData.children.push(childTree);
            }
        });
    }
    
    return nodeData;
}

// Format attributes as [key=value]
function getAttributeString(node) {
    if (!node.hasAttributes()) return '';
    
    const attrs = Array.from(node.attributes).map(attr => `${attr.name}="${attr.value}"`);
    return ` [${attrs.join(' ')}]`;
}

function jumpToLine(lineNumber) {
    // Use stored editor if available, otherwise fall back to active editor
    const editor = currentEditor || vscode.window.activeTextEditor;
    if (!editor) return;

    const position = new vscode.Position(lineNumber - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
    
    // Show the editor to bring it back into focus
    vscode.window.showTextDocument(editor.document, editor.viewColumn);
}

// WebView HTML with interactive tree
function getWebviewContent(treeData) {
    const isError = typeof treeData === 'string' && (treeData.includes('Error:') || treeData.includes('No active editor') || treeData.includes('Not an HTML file'));
    
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DOM Tree</title>
            <style>
                body {
                    font-family: 'Courier New', monospace;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 1rem;
                    margin: 0;
                    overflow-x: auto;
                }
                h2 {
                    color: var(--vscode-titleBar-activeForeground);
                    margin-top: 0;
                    font-size: 18px;
                    font-weight: bold;
                }
                .tree-container {
                    font-size: 14px;
                    line-height: 1.5;
                    margin: 0;
                    padding: 0;
                    overflow-x: auto;
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .tree-node {
                    white-space: pre;
                    margin: 0;
                    padding: 0;
                    cursor: pointer;
                    user-select: none;
                }
                .tree-node:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .tree-toggle {
                    display: inline;
                    cursor: pointer;
                    color: var(--vscode-icon-foreground);
                    font-weight: bold;
                    margin-right: 1ch;
                }
                .tree-toggle:hover {
                    color: var(--vscode-list-activeSelectionForeground);
                }
                .tree-content {
                    display: inline;
                }
                .tree-children {
                    display: block;
                }
                .tree-children.collapsed {
                    display: none;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    text-align: center;
                    padding: 20px;
                    font-style: italic;
                }
            </style>
        </head>
        <body>
            <h2>DOM Tree Viewer [HTML]</h2>
            ${isError 
                ? `<div class="error">${treeData}</div>` 
                : `<div class="tree-container">${renderTreeHTML(treeData)}</div>`}
            
            <script>
                function toggleNode(nodeId) {
                    const childrenElement = document.getElementById('children-' + nodeId);
                    const toggleElement = document.getElementById('toggle-' + nodeId);
                    
                    if (childrenElement && toggleElement) {
                        const isCollapsed = childrenElement.classList.contains('collapsed');
                        
                        if (isCollapsed) {
                            childrenElement.classList.remove('collapsed');
                            toggleElement.textContent = '[-]';
                        } else {
                            childrenElement.classList.add('collapsed');
                            toggleElement.textContent = '[+]';
                        }
                    }
                }
                
                // Initialize all toggles
                document.addEventListener('DOMContentLoaded', function() {
                    const toggles = document.querySelectorAll('.tree-toggle');
                    toggles.forEach(toggle => {
                        if (toggle.textContent === '[+]' || toggle.textContent === '[-]') {
                            toggle.textContent = '[-]'; // Start expanded
                        }
                    });
                });
            </script>
        </body>
        </html>
    `;
}

// Helper function to render tree data as HTML
function renderTreeHTML(nodeData) {
    if (!nodeData || typeof nodeData === 'string') return '';
    
    const hasChildren = nodeData.hasChildren;
    const toggleButton = hasChildren ? `<span class="tree-toggle" id="toggle-${nodeData.id}" onclick="toggleNode('${nodeData.id}')">[-]</span>` : '';
    
    let html = `<div class="tree-node">`;
    html += `<span class="tree-content">${nodeData.prefix}${nodeData.connector}${toggleButton}${nodeData.tagName}${nodeData.attrText}${nodeData.countInfo}</span>`;
    
    if (hasChildren && nodeData.children.length > 0) {
        html += `<div class="tree-children" id="children-${nodeData.id}">`;
        nodeData.children.forEach(child => {
            html += renderTreeHTML(child);
        });
        html += '</div>';
    }
    
    html += '</div>';
    return html;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};