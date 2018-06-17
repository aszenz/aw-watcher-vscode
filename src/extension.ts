// The module 'vscode' contains the VS Code extensibility API
// Import the necessary extensibility types to use in your code below
import { Disposable, ExtensionContext, commands, window, workspace, Uri } from 'vscode';
import { AWClient, Event } from '../aw-client-js/src/aw-client';
import { hostname } from 'os';

// This method is called when your extension is activated. Activation is
// controlled by the activation events defined in package.json.
export function activate(context: ExtensionContext) {
    console.log('Congratulations, your extension "ActivityWatch" is now active!');

    // Init ActivityWatch
    const controller = new ActivityWatch();
    controller.init();
    context.subscriptions.push(controller);

    // Command:Reload
    const reloadCommand = commands.registerCommand('extension.reload', () => controller.init());
    context.subscriptions.push(reloadCommand);
}

interface VSCodeEvent extends Event {
    data: {
        project: string;
        language: string;
        file: string;
    };
}

class ActivityWatch {
    private _disposable: Disposable;
    private _client: AWClient;

    // Bucket info
    private _bucket: {
        id: string;
        hostName: string;
        clientName: string;
        eventType: string;
    };
    private _bucketCreated: boolean = false;

    // Heartbeat handling
    private _pulseTime: number = 20;
    private _maxHeartbeatsPerSec: number = 1;
    private _lastFilePath: string = '';
    private _lastHeartbeatTime: number = 0; // Date.getTime()

    constructor() {
        this._bucket = {
            id: '',
            hostName: hostname(),
            clientName: 'aw-watcher-vscode',
            eventType: 'app.editor.activity'
        };
        this._bucket.id = `${this._bucket.clientName}_${this._bucket.hostName}`;

        // Create AWClient
        this._client = new AWClient(this._bucket.clientName, false);

        // subscribe to VS Code Events
        let subscriptions: Disposable[] = [];
        window.onDidChangeTextEditorSelection(this._onEvent, this, subscriptions);
        window.onDidChangeActiveTextEditor(this._onEvent, this, subscriptions);
        this._disposable = Disposable.from(...subscriptions);
    }

    public init() {
        // Create new Bucket (if not existing)
        this._client.createBucket(this._bucket.id, this._bucket.eventType, this._bucket.hostName)
            .then(() => {
                console.log('Created Bucket');
                this._bucketCreated = true;
            })
            .catch(err => {
                this._handleError("Couldn't create Bucket. Please make sure the server is running properly and then run the [Reload ActivityWatch] command.", true);
                this._bucketCreated = false;
                console.error(err);
            });
        
        this.loadConfigurations();
    }

    public loadConfigurations() {
        const extConfigurations = workspace.getConfiguration('aw-watcher-vscode');
        const maxHeartbeatsPerSec = extConfigurations.get('maxHeartbeatsPerSec');
        if (maxHeartbeatsPerSec) {
            this._maxHeartbeatsPerSec = maxHeartbeatsPerSec as number;
        }    
    }

    public dispose() {
        this._disposable.dispose();
    }

    private _onEvent() {
        if (!this._bucketCreated) {
            return;
        }

        // Create and send VSCodeEvent
        try {
            const heartbeat = this._createHeartbeat();
            const filePath = this._getFilePath();
            const curTime = new Date().getTime();
            
            // Send heartbeat if file changed or enough time passed
            if (filePath !== this._lastFilePath || this._lastHeartbeatTime + (1000 / (this._maxHeartbeatsPerSec)) < curTime) {
                this._lastFilePath = filePath;
                this._lastHeartbeatTime = curTime;
                this._sendHeartbeat(heartbeat);
            }
        }
        catch (err) {
            this._handleError(err);
        }
    }

    private _sendHeartbeat(event: VSCodeEvent) {
        return this._client.heartbeat(this._bucket.id, this._pulseTime, event)
            .then(() => console.log('Sent heartbeat', event))    
            .catch(({ err }) => this._handleError('Error while sending heartbeat', true));
    }

    private _createHeartbeat(): VSCodeEvent {
        return {
            timestamp: new Date().toISOString(),
            duration: 0,
            data: {
                language: this._getFileLanguage(),
                project: this._getProjectFolder(),
                file: this._getFilePath()
            }
        };
    }

    private _getProjectFolder(): string {
        const filePath = this._getFilePath();
        const uri = Uri.file(filePath);
        const workspaceFolder = workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            throw new Error("Couldn't get project path");
        }

        return workspaceFolder.uri.path;
    }

    private _getFilePath(): string {
        const editor = window.activeTextEditor;
        if (!editor) {
            throw new Error("Couldn't get current file path");
        }
        
        return editor.document.fileName;
    }

    private _getFileLanguage(): string {
        const editor = window.activeTextEditor;
        if (!editor) {
            throw new Error("Couldn't get current language");
        }

        return editor.document.languageId;
    }

    private _handleError(err: string, isCritical = false): undefined {
        if (isCritical) {
            console.error('[ActivityWatch][handleError]', err);
            window.showErrorMessage(`[ActivityWatch] ${err}`);
        }
        else {
            console.warn('[AcitivtyWatch][handleError]', err);
        }
        return;
    }
}
