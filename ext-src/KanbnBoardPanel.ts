import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import getNonce from './getNonce'
import KanbnTaskPanel from './KanbnTaskPanel'
import KanbnBurndownPanel from './KanbnBurndownPanel'
import { Kanbn } from '@basementuniverse/kanbn/src/main'

const sortByFields: Record<string, string> = {
  Name: 'name',
  Created: 'created',
  Updated: 'updated',
  Started: 'started',
  Completed: 'completed',
  Due: 'due',
  Assigned: 'assigned',
  'Count sub-tasks': 'countSubTasks',
  'Count tags': 'countTags',
  'Count relations': 'countRelations',
  'Count comments': 'countComments',
  Workload: 'workload',
  Progress: 'progress',
  Priority: 'priority'
}

export default class KanbnBoardPanel {
  private static readonly viewType = 'react'
  // Maps a kanbn task ID to the KanbnTaskPanel instance
  private readonly openedTaskPanels = new Map<string, KanbnTaskPanel>()
  private readonly _extensionPath: string
  private readonly _workspacePath: string
  private readonly column: vscode.ViewColumn
  private readonly _kanbnFolderName: string
  private readonly _kanbn: Kanbn
  private readonly _kanbnBurndownPanel: KanbnBurndownPanel
  private _panel: vscode.WebviewPanel | null = null
  private _updateSeq = 0
  private _suppressUpdates = false

  public async show (): Promise<void> {
    if (this._panel == null) {
      await this.setUpPanel()
    }
    this._panel?.reveal(this.column)
  }

  public showTaskPanel (taskId: string | null, column: string | null = null): void {
    let panel: KanbnTaskPanel
    if (taskId == null || !this.openedTaskPanels.has(taskId)) {
      panel = new KanbnTaskPanel(this._extensionPath, this._workspacePath, this._kanbn, this._kanbnFolderName, taskId, column, this.openedTaskPanels)
      if (taskId != null) {
        this.openedTaskPanels.set(taskId, panel)
      }
    } else {
      panel = this.openedTaskPanels.get(taskId) as KanbnTaskPanel
    }
    void panel.show()
  }

  public async update (): Promise<void> {
    if (this._suppressUpdates) return
    const seq = ++this._updateSeq
    let index: any
    try {
      index = await this._kanbn.getIndex()
    } catch (error) {
      if (error instanceof Error) {
        void vscode.window.showErrorMessage(error.message)
      } else {
        throw error
      }
      return
    }
    if (seq !== this._updateSeq) return
    let tasks: any[]
    try {
      tasks = (await this._kanbn.loadAllTrackedTasks(index)).map((task) =>
        this._kanbn.hydrateTask(index, task)
      )
    } catch (error) {
      if (error instanceof Error) {
        void vscode.window.showErrorMessage(error.message)
      } else {
        throw error
      }
      return
    }
    if (seq !== this._updateSeq) return
    void this._panel?.webview.postMessage({
      type: 'index',
      index,
      tasks,
      hiddenColumns: index.options.hiddenColumns ?? [],
      startedColumns: index.options.startedColumns ?? [],
      completedColumns: index.options.completedColumns ?? [],
      columnSorting: index.options.columnSorting ?? {},
      customFields: index.options.customFields ?? [],
      dateFormat: this._kanbn.getDateFormat(index),
      showBurndownButton: vscode.workspace.getConfiguration('kanbn').get('showBurndownButton'),
      showSprintButton: vscode.workspace.getConfiguration('kanbn').get('showSprintButton'),
      kanbnFolder: path.relative(this._workspacePath, this._kanbnFolderName)
    })
  }

  private async handleRecurrence (taskId: string, targetColumn: string): Promise<void> {
    const index = await this._kanbn.getIndex()
    const completedColumns: string[] = index.options.completedColumns ?? []

    // Only trigger on move to a completed column
    if (!completedColumns.includes(targetColumn)) return

    // Load the task to check for recurrence
    const allTasks = await this._kanbn.loadAllTrackedTasks(index)
    const task: any = allTasks.find((t: any) => t.id === taskId)
    if (task?.metadata?.recurrence == null) return

    const rec = task.metadata.recurrence

    // Calculate next due date
    const baseDate = (task.metadata.due != null) ? new Date(task.metadata.due) : new Date()
    const nextDue = new Date(baseDate)

    switch (rec.type) {
      case 'daily':
        nextDue.setDate(nextDue.getDate() + (rec.interval || 1))
        break
      case 'weekly':
        nextDue.setDate(nextDue.getDate() + (rec.interval || 1) * 7)
        break
      case 'monthly':
        nextDue.setMonth(nextDue.getMonth() + (rec.interval || 1))
        if (rec.dayOfMonth != null) {
          // Clamp to last day of the target month
          const lastDay = new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate()
          nextDue.setDate(Math.min(rec.dayOfMonth, lastDay))
        }
        break
      case 'annually':
        nextDue.setFullYear(nextDue.getFullYear() + (rec.interval || 1))
        break
    }

    // Build new task with same properties, cleared dates
    const newTask: any = {
      name: task.name,
      description: task.description || '',
      metadata: {
        created: new Date(),
        tags: task.metadata.tags != null ? [...task.metadata.tags] : [],
        recurrence: { ...rec },
        due: nextDue
      },
      subTasks: [],
      relations: [],
      comments: []
    }
    if (task.metadata.priority != null) {
      newTask.metadata.priority = task.metadata.priority
    }
    if (task.metadata.assigned != null) {
      newTask.metadata.assigned = task.metadata.assigned
    }
    if (Array.isArray(task.metadata.attachments)) {
      newTask.metadata.attachments = [...task.metadata.attachments]
    }

    // Place in first non-completed, non-hidden column (typically Backlog or Todo)
    const hiddenColumns: string[] = index.options.hiddenColumns ?? []
    const firstOpenColumn =
      Object.keys(index.columns).find(
        col => !completedColumns.includes(col) && !hiddenColumns.includes(col)
      ) ?? Object.keys(index.columns)[0]

    await this._kanbn.createTask(newTask, firstOpenColumn)
  }

  private async setUpPanel (): Promise<void> {
    // Create and show a new webview panel
    this._panel = vscode.window.createWebviewPanel(KanbnBoardPanel.viewType, 'Kanbn Board', this.column, {
      // Enable javascript in the webview
      enableScripts: true,

      // Enable Ctrl+F find widget in the webview
      enableFindWidget: true,

      // Restrict the webview to only loading content from allowed paths
      localResourceRoots: [
        vscode.Uri.file(path.join(this._extensionPath, 'build')),
        vscode.Uri.file(path.join(this._kanbnFolderName, '.kanbn')),
        vscode.Uri.file(path.join(this._extensionPath, 'node_modules', 'vscode-codicons', 'dist'))
      ]
    });
    (this._panel as any).iconPath = {
      light: vscode.Uri.file(path.join(this._extensionPath, 'resources', 'project_light.svg')),
      dark: vscode.Uri.file(path.join(this._extensionPath, 'resources', 'project_dark.svg'))
    }

    // Set the webview's title to the kanbn project name
    await this._kanbn.getIndex().then((index) => {
      if (this._panel != null) {
        this._panel.title = index.name
      }
    })

    // Set the webview's initial html content
    this._panel.webview.html = this._getHtmlForWebview()

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programatically
    this._panel.onDidDispose(() => { this._panel = null })
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          // Display error message
          case 'error':
            void vscode.window.showErrorMessage(message.text)
            return

          // Update webview. This is called when the webview first renders.
          case 'kanbn.updateMe':
            void this.update()
            return

          // Open an already existing task in the editor
          case 'kanbn.task':
            this.showTaskPanel(message.taskId, message.columnName)
            return

          // Move a task
          case 'kanbn.move':
            try {
              await this._kanbn.moveTask(message.task, message.columnName, message.position)
              await this.handleRecurrence(message.task, message.columnName)
            } catch (e) {
              if (e instanceof Error) {
                void vscode.window.showErrorMessage(e.message)
              } else {
                throw e
              }
            }
            return

          // Open a webview for a new task (with no ID)
          case 'kanbn.addTask':
            this.showTaskPanel(null, message.columnName)
            return

          // Sort a column
          case 'kanbn.sortColumn': {
            // Load the index
            const index = await this._kanbn.getIndex()
            let customFields = []
            if ('customFields' in index.options) {
              customFields = index.options.customFields.map(
                (customField: { name: string, type: string }) => customField.name
              )
            }
            // Prompt for a task property to sort by
            const sortBy: string | undefined = await vscode.window.showQuickPick(
              [
                'None',
                ...Object.keys(sortByFields),
                ...customFields
              ],
              {
                placeHolder: 'Sort this column by...',
                canPickMany: false
              }
            )
            if (sortBy !== undefined) {
              // Clear any saved sort settings for this column
              if (sortBy === 'None') {
                await this._kanbn.sort(message.columnName, [], false)
                return
              }

              // Prompt for sort direction and save settings
              const sortDirection = await vscode.window.showQuickPick(
                [
                  'Ascending',
                  'Descending'
                ],
                {
                  placeHolder: 'Sort direction',
                  canPickMany: false
                }
              )
              if (sortDirection !== undefined) {
                await this._kanbn.sort(
                  message.columnName,
                  [
                    {
                      field: sortBy in sortByFields ? sortByFields[sortBy] : sortBy,
                      order: sortDirection === 'Descending' ? 'descending' : 'ascending'
                    }
                  ],
                  true
                )
                void this.update()
              }
            }
            return
          }
          // Bulk move multiple tasks to a target column
          case 'kanbn.bulkMove': {
            const targetColumn = message.columnName as string
            const taskIds = message.taskIds as string[]
            this._suppressUpdates = true
            try {
              for (const taskId of taskIds) {
                await this._kanbn.moveTask(taskId, targetColumn, -1)
                await this.handleRecurrence(taskId, targetColumn)
              }
            } catch (e) {
              if (e instanceof Error) {
                void vscode.window.showErrorMessage(e.message)
              } else {
                throw e
              }
            } finally {
              this._suppressUpdates = false
            }
            void this.update()
            if (vscode.workspace.getConfiguration('kanbn').get<boolean>('showTaskNotifications') === true) {
              void vscode.window.showInformationMessage(
                `Moved ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} to ${targetColumn}.`
              )
            }
            return
          }

          // Bulk archive multiple tasks
          case 'kanbn.bulkArchive': {
            const archiveIds = message.taskIds as string[]
            this._suppressUpdates = true
            try {
              for (const taskId of archiveIds) {
                await this._kanbn.archiveTask(taskId)
              }
            } catch (e) {
              if (e instanceof Error) {
                void vscode.window.showErrorMessage(e.message)
              } else {
                throw e
              }
            } finally {
              this._suppressUpdates = false
            }
            void this.update()
            if (vscode.workspace.getConfiguration('kanbn').get<boolean>('showTaskNotifications') === true) {
              void vscode.window.showInformationMessage(
                `Archived ${archiveIds.length} task${archiveIds.length === 1 ? '' : 's'}.`
              )
            }
            return
          }

          // Open a burndown chart
          case 'kanbn.burndown':
            this._kanbnBurndownPanel.show()
            void this.update()
            return

            // Quick-update task properties from the board context menu (75.23)
          case 'kanbn.quickUpdate': {
            const { taskId, updates } = message
            try {
              const index = await this._kanbn.getIndex()
              const allTasks = await this._kanbn.loadAllTrackedTasks(index)
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              const task: any = allTasks.find((t: any) => t.id === taskId)
              if (task == null) {
                void vscode.window.showErrorMessage(`Task not found: ${taskId as string}`)
                break
              }
              // Find current column
              let currentColumn = ''
              for (const [col, ids] of Object.entries(index.columns)) {
                if ((ids as any[]).some((item: any) => item === taskId)) {
                  currentColumn = col
                  break
                }
              }
              // Apply property updates
              if (updates.priority !== undefined) {
                if (updates.priority === '') {
                  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                  delete task.metadata.priority
                } else {
                  task.metadata.priority = updates.priority
                }
              }
              if (updates.progress !== undefined) {
                task.metadata.progress = Number(updates.progress)
              }
              if (updates.due !== undefined) {
                if (updates.due) {
                  task.metadata.due = new Date(updates.due)
                } else {
                  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                  delete task.metadata.due
                }
              }
              if (updates.started !== undefined) {
                if (updates.started) {
                  task.metadata.started = new Date(updates.started)
                } else {
                  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                  delete task.metadata.started
                }
              }
              if (updates.tags !== undefined) {
                task.metadata.tags = updates.tags
              }
              // Determine column change
              const targetColumn = (updates.column != null && updates.column !== currentColumn) ? updates.column : null
              await this._kanbn.updateTask(taskId, task, targetColumn)
              if (targetColumn != null) {
                await this.handleRecurrence(taskId, targetColumn)
              }
              await this.update()
            } catch (e: any) {
              void vscode.window.showErrorMessage(`Failed to update task: ${e.message as string}`)
            }
            break
          }

          // Start a new sprint
          case 'kanbn.sprint': {
            // Prompt for a sprint name
            const newSprintName = await vscode.window.showInputBox({
              placeHolder: 'The sprint name.'
            })

            // If the input prompt wasn't cancelled, start a new sprint
            if (newSprintName !== undefined) {
              try {
                await this._kanbn.sprint(newSprintName, '', new Date())
              } catch (e) {
                if (e instanceof Error) {
                  void vscode.window.showErrorMessage(e.message)
                } else {
                  throw e
                }
              }
            }
            void this._kanbnBurndownPanel.update()
          }
        }
      })
  }

  constructor (
    extensionPath: string,
    workspacePath: string,
    kanbn: Kanbn,
    kanbnFolderName: string,
    kanbnBurndownPanel: KanbnBurndownPanel
  ) {
    this._extensionPath = extensionPath
    this._workspacePath = workspacePath
    this._kanbn = kanbn
    this.column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One
    this._kanbnFolderName = kanbnFolderName
    this._kanbnBurndownPanel = kanbnBurndownPanel
  }

  private _getHtmlForWebview (): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest = require(path.join(this._extensionPath, 'build', 'asset-manifest.json'))
    const mainScript = manifest.files['main.js']
    const mainStyle = manifest.files['main.css']
    if (this._panel === null) {
      throw new Error('panel is undefined')
    }
    const webview = this._panel.webview
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionPath, 'build', mainScript)))
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionPath, 'build', mainStyle)))
    const boardCssPath = path.join(this._kanbnFolderName, '.kanbn', 'board.css')
    const boardCssExists = fs.existsSync(boardCssPath)
    const customStyleTag = boardCssExists
      ? `<link rel="stylesheet" type="text/css" href="${webview.asWebviewUri(vscode.Uri.file(boardCssPath)).toString()}">`
      : ''
    const codiconsUri = webview.asWebviewUri(vscode.Uri.file(
      path.join(this._extensionPath, 'node_modules', 'vscode-codicons', 'dist', 'codicon.css')
    ))

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
<meta name="theme-color" content="#000000">
<title>Kanbn Board</title>
<link rel="stylesheet" type="text/css" href="${styleUri.toString()}">
${customStyleTag}
<link rel="stylesheet" type="text/css" href="${codiconsUri.toString()}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview-resource: https:; script-src 'nonce-${nonce}'; font-src vscode-webview-resource:; style-src vscode-webview-resource: 'unsafe-inline' http: https: data:;">
<base href="${webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionPath, 'build'))).toString()})}/">
</head>
<body>
<noscript>You need to enable JavaScript to run this app.</noscript>
<div id="root-board"></div>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`
  }
}
