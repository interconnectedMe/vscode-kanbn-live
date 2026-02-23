/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { DragDropContext, Droppable } from 'react-beautiful-dnd'
import React, { useState, useCallback, useEffect, useRef } from 'react'
import TaskItem from './TaskItem'
import { paramCase } from '@basementuniverse/kanbn/src/utility'
import vscode from './vscode'
import formatDate from 'dateformat'

const zip = (a: any[], b: any[]): Array<[any, any]> => a.map((v: any, i: number): [any, any] => [v, b[i]])

// Called when a task item has finished being dragged
const onDragEnd = (result, columns, setColumns, clearSelection, selectedTaskIds: Set<string>): void => {
  // No destination means the item was dragged to an invalid location
  if (result.destination === undefined || result.destination === null) {
    return
  }

  // Get the source and destination columns
  const { source, destination } = result
  const draggedTaskId = result.draggableId

  // Multi-drag: if the dragged card is part of a multi-selection, move all selected cards
  if (selectedTaskIds.has(draggedTaskId) && selectedTaskIds.size > 1) {
    const targetColumn = destination.droppableId
    const taskIds = [...selectedTaskIds]

    // Update local state: remove selected tasks from current columns, insert into target
    const newColumns: Record<string, any[]> = {}
    const selectedTasks: any[] = []
    for (const colName in columns) {
      const remaining: any[] = []
      for (const task of columns[colName]) {
        if (selectedTaskIds.has(task.id)) {
          selectedTasks.push(task)
        } else {
          remaining.push(task)
        }
      }
      newColumns[colName] = remaining
    }
    const targetTasks = newColumns[targetColumn] ?? []
    const insertIdx = Math.min(destination.index, targetTasks.length)
    targetTasks.splice(insertIdx, 0, ...selectedTasks)
    newColumns[targetColumn] = targetTasks
    setColumns(newColumns)

    // Persist to backend
    vscode.postMessage({
      command: 'kanbn.bulkMove',
      taskIds,
      columnName: targetColumn
    })
    clearSelection()
    return
  }

  // Single-card drag
  // The item that was moved
  let removed: KanbnTask

  // The task was dragged from one column to another
  if (source.droppableId !== destination.droppableId) {
    const sourceItems = columns[source.droppableId]
    const destItems = columns[destination.droppableId];
    [removed] = sourceItems.splice(source.index, 1)
    destItems.splice(destination.index, 0, removed)
    setColumns({
      ...columns,
      [source.droppableId]: sourceItems,
      [destination.droppableId]: destItems
    })

  // The task was dragged into the same column
  } else {
    // If the task was dragged to the same position that it currently occupies, don't move it (this will
    // prevent unnecessarily setting the task's updated date)
    if (source.index === destination.index) {
      return
    }
    const copiedItems = columns[source.droppableId];
    [removed] = copiedItems.splice(source.index, 1)
    copiedItems.splice(destination.index, 0, removed)
    setColumns({
      ...columns,
      [source.droppableId]: copiedItems
    })
  }

  // Clear selection after drag
  clearSelection()

  // Post a message back to the extension so we can move the task in the index
  vscode.postMessage({
    command: 'kanbn.move',
    task: removed.id,
    columnName: destination.droppableId,
    position: destination.index
  })
}

// Parse date strings, handling DD/MM/YYYY format that JavaScript misinterprets as MM/DD/YYYY
const parseDate = (value: any): Date | null => {
  if (value == null) return null
  const s = String(value)
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch != null) {
    const day = parseInt(slashMatch[1], 10)
    const month = parseInt(slashMatch[2], 10)
    const year = parseInt(slashMatch[3], 10)
    return new Date(year, month - 1, day)
  }
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d
}

// Check if a task's due date is in the past
const checkOverdue = (task: KanbnTask): boolean => {
  if (task.metadata.due !== undefined) {
    const d = parseDate(task.metadata.due)
    return d != null && d.getTime() < (new Date()).getTime()
  }
  return false
}

// A list of property names that can be filtered
const filterProperties = [
  'description',
  'assigned',
  'tag',
  'relation',
  'subtask',
  'comment'
]

// Filter tasks according to the filter string
const filterTask = (
  task: KanbnTask,
  taskFilter: string,
  customFields: Array<{ name: string, type: 'boolean' | 'date' | 'number' | 'string' }>
): boolean => {
  let result = true
  const customFieldMap = Object.fromEntries(customFields.map(customField => [
    customField.name.toLowerCase(),
    customField
  ]))
  const customFieldNames = Object.keys(customFieldMap)
  taskFilter.split(' ').forEach(f => {
    const parts = f.split(':').map(p => p.toLowerCase())

    // This filter section doesn't contain a property name
    if (parts.length === 1) {
      // Filter for overdue tasks
      if (parts[0] === 'overdue') {
        if (!checkOverdue(task)) {
          result = false
        }
        return
      }

      // Filter boolean custom fields
      if (customFieldNames.includes(parts[0]) && customFieldMap[parts[0]].type === 'boolean') {
        if (
          !(customFieldMap[parts[0]].name in task.metadata) ||
          !(task.metadata[customFieldMap[parts[0]].name] === null || task.metadata[customFieldMap[parts[0]].name] === undefined)
        ) {
          result = false
        }
        return
      }

      // Filter task id or name
      if (
        !task.id.toLowerCase().includes(parts[0]) &&
        !task.name.toLowerCase().includes(parts[0])
      ) {
        result = false
      }
      return
    }

    // If this filter section contains a property name and value, check the value against the property
    if (
      parts.length === 2 && (
        filterProperties.includes(parts[0]) ||
        customFieldNames.includes(parts[0])
      )
    ) {
      // Fetch the value to filter by
      let propertyValue = ''
      switch (parts[0]) {
        case 'description':
          propertyValue = [
            task.description,
            ...task.subTasks.map(subTask => subTask.text)
          ].join(' ')
          break
        case 'assigned':
          propertyValue = task.metadata.assigned ?? ''
          break
        case 'tag':
          propertyValue = (task.metadata.tags ?? []).join(' ')
          break
        case 'relation':
          propertyValue = task.relations.map(relation => `${relation.type} ${relation.task}`).join(' ')
          break
        case 'subtask':
          propertyValue = task.subTasks.map(subTask => `${subTask.text}`).join(' ')
          break
        case 'comment':
          propertyValue = task.comments.map(comment => `${comment.author} ${comment.text}`).join(' ')
          break
        default:
          if (
            customFieldNames.includes(parts[0]) &&
            customFieldMap[parts[0]].type !== 'boolean' &&
            customFieldMap[parts[0]].name in task.metadata
          ) {
            propertyValue = `${task.metadata[customFieldMap[parts[0]].name]}`
          }
          break
      }

      // Check the search term against the value
      if (!propertyValue.toLowerCase().includes(parts[1])) {
        result = false
      }
    }
  })
  return result
}

// Help popover content
interface HelpItem {
  label: string
  desc: string
}
interface HelpSection {
  heading: string
  items: HelpItem[]
}
const helpContent: HelpSection[] = [
  {
    heading: 'Filter Syntax',
    items: [
      {
        label: 'Text search',
        desc: 'Type any text to match task name or ID'
      },
      {
        label: 'description:term',
        desc: 'Search in description and subtask text'
      },
      {
        label: 'assigned:name',
        desc: 'Filter by assignee'
      },
      {
        label: 'tag:name',
        desc: 'Filter by tag'
      },
      {
        label: 'relation:term',
        desc: 'Filter by relation type or task'
      },
      {
        label: 'subtask:term',
        desc: 'Search subtask text'
      },
      {
        label: 'comment:term',
        desc: 'Search comment author or text'
      },
      {
        label: 'overdue',
        desc: 'Show only overdue tasks'
      }
    ]
  },
  {
    heading: 'Multi-Select',
    items: [
      {
        label: 'Ctrl+Click',
        desc: 'Toggle select individual cards'
      },
      {
        label: 'Shift+Click',
        desc: 'Select a range within a column'
      },
      {
        label: 'Click away',
        desc: 'Deselect all'
      }
    ]
  },
  {
    heading: 'Keyboard Shortcuts',
    items: [
      {
        label: '/',
        desc: 'Focus the filter input'
      },
      {
        label: 'Escape',
        desc: 'Close popover / clear selection / clear filter'
      },
      {
        label: 'Click tag',
        desc: 'Filter by that tag'
      }
    ]
  },
  {
    heading: 'Commands (Ctrl+Shift+P)',
    items: [
      {
        label: 'Kanbn: Open board',
        desc: 'Open a Kanbn board panel'
      },
      {
        label: 'Kanbn: Add task',
        desc: 'Create a new task'
      },
      {
        label: 'Kanbn: Open task',
        desc: 'Open an existing task'
      },
      {
        label: 'Kanbn: Archive tasks',
        desc: 'Archive tasks via picker'
      },
      {
        label: 'Kanbn: Restore tasks',
        desc: 'Restore archived tasks'
      },
      {
        label: 'Kanbn: Open burndown',
        desc: 'View burndown chart'
      },
      {
        label: 'Kanbn: Create board',
        desc: 'Create a new board'
      }
    ]
  },
  {
    heading: 'Settings (kanbn.*)',
    items: [
      {
        label: 'additionalBoards',
        desc: 'Array of extra board paths'
      },
      {
        label: 'showBurndownButton',
        desc: 'Show burndown chart button'
      },
      {
        label: 'showSprintButton',
        desc: 'Show sprint button'
      },
      {
        label: 'showTaskNotifications',
        desc: 'Notify on task create/update/delete'
      },
      {
        label: 'showUninitialisedStatusBarItem',
        desc: 'Show status bar when uninitialised'
      }
    ]
  }
]

function Board (): JSX.Element {
  const [state, setState] = useState(vscode.getState() ?? {
    name: '',
    description: '',
    columns: {},
    hiddenColumns: [],
    startedColumns: [],
    completedColumns: [],
    columnSorting: {},
    customFields: [],
    dateFormat: '',
    showBurndownButton: false,
    showSprintButton: false,
    currentSprint: null,
    taskFilter: '',
    kanbnFolder: ''
  })

  // 75.26: Single-column focused view
  const [focusedColumn, setFocusedColumn] = useState<string | null>(null)
  // 75.27: List view mode
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')

  // 75.23: Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    task: KanbnTask
    columnName: string
    submenu: string | null
  } | null>(null)

  // Multi-select state
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const selectedTaskIdsRef = useRef<Set<string>>(selectedTaskIds)
  selectedTaskIdsRef.current = selectedTaskIds
  const [lastClicked, setLastClicked] = useState<{ taskId: string, columnName: string, position: number } | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)
  const moveMenuRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const isDraggingRef = useRef(false)

  // 75.14: Filter autocomplete options
  const filterOptions = [
    { prefix: 'description:', desc: 'Search in description and subtask text' },
    { prefix: 'assigned:', desc: 'Filter by assignee' },
    { prefix: 'tag:', desc: 'Filter by tag' },
    { prefix: 'relation:', desc: 'Filter by relation type or task' },
    { prefix: 'subtask:', desc: 'Search subtask text' },
    { prefix: 'comment:', desc: 'Search comment author or text' },
    { prefix: 'overdue', desc: 'Show only overdue tasks' }
  ]

  const clearSelection = useCallback(() => {
    setSelectedTaskIds(new Set())
    setLastClicked(null)
    setShowArchiveConfirm(false)
  }, [])

  // 75.23: Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, task: KanbnTask, columnName: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, task, columnName, submenu: null })
  }, [])

  // Click-away to deselect: listen on the board background
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (isDraggingRef.current) return
      const target = e.target as HTMLElement
      // Don't deselect if clicking within a task, the bulk toolbar, or the help popover
      if (
        target.closest('.kanbn-task') != null ||
        target.closest('.kanbn-bulk-toolbar') != null ||
        target.closest('.kanbn-help-popover') != null ||
        target.closest('.kanbn-help-button') != null
      ) {
        return
      }
      if (selectedTaskIds.size > 0) {
        clearSelection()
      }
    }
    document.addEventListener('click', handleClick)
    return () => { document.removeEventListener('click', handleClick) }
  }, [selectedTaskIds, clearSelection])

  // Close help popover on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (
        showHelp &&
        helpRef.current != null &&
        !helpRef.current.contains(target) &&
        target.closest('.kanbn-help-button') == null
      ) {
        setShowHelp(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => { document.removeEventListener('click', handleClick) }
  }, [showHelp])

  // Close move menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (
        showMoveMenu &&
        moveMenuRef.current != null &&
        !moveMenuRef.current.contains(target) &&
        target.closest('.kanbn-bulk-move-button') == null
      ) {
        setShowMoveMenu(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => { document.removeEventListener('click', handleClick) }
  }, [showMoveMenu])

  // 75.23: Close context menu on click outside
  useEffect(() => {
    if (contextMenu === null) return
    const handler = (): void => { setContextMenu(null) }
    document.addEventListener('click', handler)
    return () => { document.removeEventListener('click', handler) }
  }, [contextMenu])

  // Keyboard shortcuts: Escape (close/clear), / (focus filter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // 75.23: Close context menu first
        if (contextMenu !== null) {
          setContextMenu(null)
        } else if (showFilterDropdown) {
          setShowFilterDropdown(false)
        } else if (showHelp) {
          setShowHelp(false)
        } else if (showMoveMenu) {
          setShowMoveMenu(false)
        } else if (focusedColumn !== null) {
          // 75.26: Escape exits single-column focus
          setFocusedColumn(null)
        } else if (selectedTaskIds.size > 0) {
          clearSelection()
        } else if (state.taskFilter !== '') {
          // 75.13: Escape clears filter
          if (filterInputRef.current != null) { filterInputRef.current.value = '' }
          setTaskFilter('')
        }
      }
      // 75.10: / focuses filter input (unless already typing in an input/textarea)
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault()
        if (filterInputRef.current != null) { filterInputRef.current.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [contextMenu, showFilterDropdown, showHelp, showMoveMenu, focusedColumn, selectedTaskIds, clearSelection, state.taskFilter])

  // Handle task selection (Ctrl+click toggle, Shift+click range)
  const handleTaskSelect = useCallback((taskId: string, columnName: string, position: number, e: React.MouseEvent) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)

      if (e.shiftKey && lastClicked != null && lastClicked.columnName === columnName) {
        // Shift+click: select range within same column
        const tasks = (state.columns[columnName] as KanbnTask[] ?? [])
          .filter(task => filterTask(task, state.taskFilter, state.customFields))
        const startIdx = Math.min(lastClicked.position, position)
        const endIdx = Math.max(lastClicked.position, position)
        for (let i = startIdx; i <= endIdx; i++) {
          if (tasks[i] != null) {
            next.add(tasks[i].id)
          }
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: toggle individual
        if (next.has(taskId)) {
          next.delete(taskId)
        } else {
          next.add(taskId)
        }
      } else {
        // Plain click with modifier — shouldn't reach here, but treat as toggle
        if (next.has(taskId)) {
          next.delete(taskId)
        } else {
          next.add(taskId)
        }
      }

      return next
    })
    setLastClicked({ taskId, columnName, position })
  }, [lastClicked, state.columns, state.taskFilter, state.customFields])

  const handleBulkMove = useCallback((targetColumn: string) => {
    const taskIds = [...selectedTaskIds]
    vscode.postMessage({
      command: 'kanbn.bulkMove',
      taskIds,
      columnName: targetColumn
    })
    clearSelection()
    setShowMoveMenu(false)
  }, [selectedTaskIds, clearSelection])

  // Handle tag click: set filter to tag:<tagname>
  const handleTagClick = useCallback((tag: string) => {
    const filterValue = `tag:${tag}`
    if (filterInputRef.current != null) {
      filterInputRef.current.value = filterValue
    }
    setTaskFilter(filterValue)
  }, [])

  // Handle select all visible tasks in a column
  const handleSelectAllInColumn = useCallback((columnName: string) => {
    const tasks = (state.columns[columnName] as KanbnTask[] ?? [])
      .filter(task => filterTask(task, state.taskFilter, state.customFields))
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      const allSelected = tasks.every(t => next.has(t.id))
      if (allSelected) {
        // Deselect all in this column
        tasks.forEach(t => next.delete(t.id))
      } else {
        // Select all in this column
        tasks.forEach(t => next.add(t.id))
      }
      return next
    })
  }, [state.columns, state.taskFilter, state.customFields])

  const handleBulkArchive = useCallback(() => {
    const taskIds = [...selectedTaskIds]
    vscode.postMessage({
      command: 'kanbn.bulkArchive',
      taskIds
    })
    clearSelection()
  }, [selectedTaskIds, clearSelection])

  const processMessage = useCallback(event => {
    const newState: any = {}
    const tasks = Object.fromEntries((event.data.tasks ?? []).map(task => [task.id, task]))

    newState.name = event.data.index.name
    newState.description = event.data.index.description
    const columns = Object.fromEntries(
      zip(
        Object.keys(event.data.index.columns),
        Object.values(event.data.index.columns).map(column => (column as string[]).map(taskId => tasks[taskId]))
      )
    )
    newState.columns = columns
    newState.hiddenColumns = event.data.hiddenColumns
    newState.startedColumns = event.data.startedColumns
    newState.completedColumns = event.data.completedColumns
    newState.columnSorting = event.data.columnSorting
    newState.customFields = event.data.customFields
    newState.showBurndownButton = event.data.showBurndownButton
    newState.showSprintButton = event.data.showSprintButton
    newState.kanbnFolder = event.data.kanbnFolder ?? ''

    // Get current sprint
    let sprint = null
    if ('sprints' in event.data.index.options && event.data.index.options.sprints.length > 0) {
      sprint = event.data.index.options.sprints[event.data.index.options.sprints.length - 1]
    }
    newState.currentSprint = sprint
    newState.dateFormat = event.data.dateFormat
    newState.taskFilter = state.taskFilter
    vscode.setState(newState)
    setState(newState)
  }, [])

  useEffect(() => {
    window.addEventListener('message', processMessage)
    return () => {
      window.removeEventListener('message', processMessage)
    }
  }, [])

  const setColumns = (columns): void => {
    const newState = { ...state }
    newState.columns = columns
    setState(newState)
  }
  const setTaskFilter = (taskFilter): void => {
    const newState = { ...state }
    newState.taskFilter = taskFilter
    setState(newState)
  }

  // Called when the clear filter button is clicked
  const clearFilters = (e: React.UIEvent<HTMLElement>): void => {
    if (filterInputRef.current != null) { filterInputRef.current.value = '' }
    filterTasks(e)
  }

  // Called when the filter form is submitted
  const filterTasks = (e: React.UIEvent<HTMLElement>): void => {
    e.preventDefault()
    setTaskFilter(filterInputRef.current?.value ?? '')
  }

  const taskFilter = state.taskFilter
  const columnNames = Object.keys(state.columns).filter(
    col => !(state.hiddenColumns.includes(col) as boolean)
  )

  // 75.27: View mode toggle buttons (shared helper, rendered in both header and focused header)
  const viewModeToggle = (
    <div className="kanbn-view-mode-toggle">
      <button
        type="button"
        className={`kanbn-view-mode-button${viewMode === 'cards' ? ' kanbn-view-mode-active' : ''}`}
        onClick={() => { setViewMode('cards') }}
        title="Card view"
      >
        <i className="codicon codicon-symbol-class"></i>
      </button>
      <button
        type="button"
        className={`kanbn-view-mode-button${viewMode === 'list' ? ' kanbn-view-mode-active' : ''}`}
        onClick={() => { setViewMode('list') }}
        title="List view"
      >
        <i className="codicon codicon-list-flat"></i>
      </button>
    </div>
  )

  // Indicate that the board is ready to receive messages and should be updated
  useEffect(() => vscode.postMessage({ command: 'kanbn.updateMe' }), [])

  // 75.26: Determine which columns to render
  const visibleColumns = focusedColumn !== null
    ? Object.entries(state.columns).filter(([name]) => name === focusedColumn)
    : Object.entries(state.columns).filter(([name]) => !((state.hiddenColumns ?? []).includes(name) as boolean))

  return (
    <>
      <div className="kanbn-header">
        <h1 className="kanbn-header-name">
          <p>{state.name}</p>
          <div className="kanbn-filter">
            <form>
              <div className="kanbn-filter-input-wrapper">
                <input
                  className="kanbn-filter-input"
                  placeholder="Filter tasks"
                  ref={filterInputRef}
                  onFocus={() => { setShowFilterDropdown(true) }}
                  onBlur={() => { setTimeout(() => { setShowFilterDropdown(false) }, 150) }}
                  onInput={() => { setShowFilterDropdown(true) }}
                />
                {showFilterDropdown && (
                  <div className="kanbn-filter-dropdown">
                    {filterOptions
                      .filter(opt => {
                        const inputVal = filterInputRef.current?.value?.toLowerCase() ?? ''
                        return inputVal === '' || opt.prefix.toLowerCase().startsWith(inputVal) || opt.desc.toLowerCase().includes(inputVal)
                      })
                      .map(opt => (
                        <button
                          key={opt.prefix}
                          type="button"
                          className="kanbn-filter-dropdown-item"
                          onMouseDown={(e) => {
                            e.preventDefault() // prevent blur from hiding dropdown before click registers
                            if (filterInputRef.current != null) {
                              filterInputRef.current.value = opt.prefix
                              filterInputRef.current.focus()
                              filterInputRef.current.setSelectionRange(opt.prefix.length, opt.prefix.length)
                            }
                            if (!opt.prefix.endsWith(':')) {
                              // 'overdue' is a complete filter — apply immediately
                              setTaskFilter(opt.prefix)
                              setShowFilterDropdown(false)
                            }
                          }}
                        >
                          <span className="kanbn-filter-dropdown-prefix">{opt.prefix}</span>
                          <span className="kanbn-filter-dropdown-desc">{opt.desc}</span>
                        </button>
                      ))
                    }
                  </div>
                )}
              </div>
              <button
                type="submit"
                className="kanbn-header-button kanbn-header-button-filter"
                onClick={filterTasks}
                title="Filter tasks"
              >
                <i className="codicon codicon-filter"></i>
              </button>
              {
                taskFilter !== '' &&
                <button
                  type="button"
                  className="kanbn-header-button kanbn-header-button-clear-filter"
                  onClick={clearFilters}
                  title="Clear task filters"
                >
                  <i className="codicon codicon-close"></i>
                </button>
              }
              <button
                type="button"
                className="kanbn-header-button kanbn-help-button"
                onClick={(e) => {
                  e.preventDefault()
                  setShowHelp(!showHelp)
                }}
                title="Help — commands, settings, filter syntax"
              >
                <i className="codicon codicon-question"></i>
              </button>
              {
                showHelp &&
                <div className="kanbn-help-popover" ref={helpRef}>
                  <div className="kanbn-help-section">
                    <h3>Quick Filters</h3>
                    <div className="kanbn-quick-filters">
                      {[
                        { label: 'description:', prefix: 'description:' },
                        { label: 'assigned:', prefix: 'assigned:' },
                        { label: 'tag:', prefix: 'tag:' },
                        { label: 'subtask:', prefix: 'subtask:' },
                        { label: 'comment:', prefix: 'comment:' },
                        { label: 'overdue', prefix: 'overdue' }
                      ].map(qf => (
                        <button
                          key={qf.label}
                          type="button"
                          className="kanbn-quick-filter-chip"
                          onClick={() => {
                            if (filterInputRef.current != null) {
                              filterInputRef.current.value = qf.prefix
                              filterInputRef.current.focus()
                              // Place cursor at end for prefixes that need a value
                              filterInputRef.current.setSelectionRange(qf.prefix.length, qf.prefix.length)
                            }
                            if (!qf.prefix.endsWith(':')) {
                              setTaskFilter(qf.prefix)
                            }
                          }}
                        >
                          {qf.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {helpContent.map(section => (
                    <div key={section.heading} className="kanbn-help-section">
                      <h3>{section.heading}</h3>
                      <dl>
                        {section.items.map(item => (
                          <React.Fragment key={item.label}>
                            <dt>{item.label}</dt>
                            <dd>{item.desc}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              }
              {
                state.showSprintButton as boolean &&
                <button
                  type="button"
                  className="kanbn-header-button kanbn-header-button-sprint"
                  onClick={() => {
                    vscode.postMessage({
                      command: 'kanbn.sprint'
                    })
                  }}
                  title={[
                    'Start a new sprint',
                    (state.currentSprint != null)
                      ? `Current sprint:\n  ${state.currentSprint.name}\n  Started ${formatDate(state.currentSprint.start, state.dateFormat)}`
                      : ''
                  ].join('\n')}
                >
                  <i className="codicon codicon-rocket"></i>
                  {(state.currentSprint != null) ? state.currentSprint.name : 'No sprint'}
                </button>
              }
              {
                state.showBurndownButton as boolean &&
                <button
                  type="button"
                  className="kanbn-header-button kanbn-header-button-burndown"
                  onClick={() => {
                    vscode.postMessage({
                      command: 'kanbn.burndown'
                    })
                  }}
                  title="Open burndown chart"
                >
                  <i className="codicon codicon-graph"></i>
                </button>
              }
              {/* 75.27: View mode toggle in main header */}
              {viewModeToggle}
            </form>
          </div>
        </h1>
        <p className="kanbn-header-description">
          {state.description}
        </p>
      </div>
      {/* 75.26: Focused column header — back button + column name + view mode toggle */}
      {focusedColumn !== null && (
        <div className="kanbn-focused-header">
          <button
            type="button"
            className="kanbn-focused-back-button"
            onClick={() => { setFocusedColumn(null) }}
            title="Back to all columns"
          >
            <i className="codicon codicon-arrow-left"></i> All columns
          </button>
          <span className="kanbn-focused-column-name">{focusedColumn}</span>
          {viewModeToggle}
        </div>
      )}
      {
        selectedTaskIds.size > 0 &&
        <div className="kanbn-bulk-toolbar">
          <span className="kanbn-bulk-toolbar-count">{selectedTaskIds.size} card{selectedTaskIds.size !== 1 ? 's' : ''} selected</span>
          <div className="kanbn-bulk-toolbar-actions">
            <div className="kanbn-bulk-move-wrapper">
              <button
                type="button"
                className="kanbn-bulk-toolbar-button kanbn-bulk-move-button"
                onClick={() => { setShowMoveMenu(!showMoveMenu) }}
              >
                <i className="codicon codicon-arrow-right"></i> Move to...
              </button>
              {
                showMoveMenu &&
                <div className="kanbn-bulk-move-menu" ref={moveMenuRef}>
                  {columnNames.map(col => (
                    <button
                      key={col}
                      type="button"
                      className="kanbn-bulk-move-menu-item"
                      onClick={() => { handleBulkMove(col) }}
                    >
                      {col}
                    </button>
                  ))}
                </div>
              }
            </div>
            {
              !showArchiveConfirm
                ? <button
                    type="button"
                    className="kanbn-bulk-toolbar-button kanbn-bulk-archive-button"
                    onClick={() => { setShowArchiveConfirm(true) }}
                  >
                    <i className="codicon codicon-archive"></i> Archive
                  </button>
                : <span className="kanbn-bulk-archive-confirm">
                    Archive {selectedTaskIds.size} card{selectedTaskIds.size !== 1 ? 's' : ''}?
                    <button
                      type="button"
                      className="kanbn-bulk-toolbar-button kanbn-bulk-archive-confirm-yes"
                      onClick={() => { handleBulkArchive(); setShowArchiveConfirm(false) }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="kanbn-bulk-toolbar-button kanbn-bulk-archive-confirm-no"
                      onClick={() => { setShowArchiveConfirm(false) }}
                    >
                      Cancel
                    </button>
                  </span>
            }
            <button
              type="button"
              className="kanbn-bulk-toolbar-button kanbn-bulk-deselect-button"
              onClick={clearSelection}
            >
              <i className="codicon codicon-close"></i>
            </button>
          </div>
        </div>
      }
      <div className={`kanbn-board${focusedColumn !== null ? ' kanbn-board-focused' : ''}`}>
        <DragDropContext
          onBeforeDragStart={() => { isDraggingRef.current = true }}
          onDragEnd={result => {
            isDraggingRef.current = false
            onDragEnd(result, state.columns, setColumns, clearSelection, selectedTaskIdsRef.current)
          }}
        >
          {visibleColumns.map(([columnName, column]) => {
            const filteredTasks = (column as any[]).filter(task => filterTask(task, taskFilter, state.customFields))
            return (
              <div
                className={[
                  'kanbn-column',
                  `kanbn-column-${paramCase(columnName)}`
                ].join(' ')}
                key={columnName}
              >
                <h2 className="kanbn-column-name">
                  {
                    state.startedColumns.includes(columnName) as boolean &&
                    <i className="codicon codicon-play"></i>
                  }
                  {
                    state.completedColumns.includes(columnName) as boolean &&
                    <i className="codicon codicon-check"></i>
                  }
                  {/* 75.26: Clickable column name to enter single-column focus */}
                  <button
                    type="button"
                    className="kanbn-column-name-button"
                    title="Click to focus on this column"
                    onClick={() => { setFocusedColumn(columnName) }}
                  >
                    {columnName}
                  </button>
                  <span className="kanbn-column-count">{(column as any).length}</span>
                  <button
                    type="button"
                    className="kanbn-column-button kanbn-select-all-button"
                    title={`Select all in ${columnName}`}
                    onClick={(e) => { e.stopPropagation(); handleSelectAllInColumn(columnName) }}
                  >
                    <i className="codicon codicon-check-all"></i>
                  </button>
                  <button
                    type="button"
                    className="kanbn-column-button kanbn-create-task-button"
                    title={`Create task in ${columnName}`}
                    onClick={() => {
                      vscode.postMessage({
                        command: 'kanbn.addTask',
                        columnName
                      })
                    }}
                  >
                    <i className="codicon codicon-add"></i>
                  </button>
                  {((columnIsSorted, columnSortSettings) => (
                    <button
                      type="button"
                      className={[
                        'kanbn-column-button',
                        'kanbn-sort-column-button',
                        columnIsSorted ? 'kanbn-column-sorted' : null
                      ].filter(i => i).join(' ')}
                      title={`Sort ${columnName}${columnIsSorted
                        ? `\nCurrently sorted by:\n${columnSortSettings.map(
                          sorter => `${sorter.field} (${sorter.order})`
                        ).join('\n')}`
                        : ''
                      }`}
                      onClick={() => {
                        vscode.postMessage({
                          command: 'kanbn.sortColumn',
                          columnName
                        })
                      }}
                    >
                      <i className="codicon codicon-list-filter"></i>
                    </button>
                  ))(columnName in state.columnSorting, state.columnSorting[columnName] ?? [])}
                </h2>
                <div className="kanbn-column-task-list-container">
                  {/* 75.27: List view renders a flat table instead of draggable cards */}
                  {viewMode === 'list'
                    ? (
                    <div className="kanbn-list-view">
                      <div className="kanbn-list-header">
                        <span className="kanbn-list-col kanbn-list-col-name">Name</span>
                        <span className="kanbn-list-col kanbn-list-col-priority">Priority</span>
                        <span className="kanbn-list-col kanbn-list-col-tags">Tags</span>
                        <span className="kanbn-list-col kanbn-list-col-progress">Progress</span>
                        <span className="kanbn-list-col kanbn-list-col-date">
                          {(state.completedColumns.includes(columnName) as boolean) ? 'Completed' : 'Due'}
                        </span>
                      </div>
                      {filteredTasks.map((task: any, position: number) => {
                        const isCompletedCol = state.completedColumns.includes(columnName) as boolean
                        const dateVal: any = isCompletedCol
                          ? task.metadata?.completed
                          : task.metadata?.due
                        let parsedDate: Date | null = null
                        if (dateVal != null) {
                          const s = String(dateVal)
                          const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
                          if (slashMatch != null) {
                            parsedDate = new Date(parseInt(slashMatch[3], 10), parseInt(slashMatch[2], 10) - 1, parseInt(slashMatch[1], 10))
                          } else {
                            const d = new Date(s)
                            if (!isNaN(d.getTime())) { parsedDate = d }
                          }
                        }
                        const displayDate = parsedDate != null
                          ? formatDate(parsedDate, state.dateFormat)
                          : ''
                        const taskProgress = task.progress as number | undefined
                        return (
                          <div
                            key={task.id}
                            className={`kanbn-list-row${selectedTaskIds.has(task.id) ? ' kanbn-list-row-selected' : ''}`}
                            onClick={(e) => {
                              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                                handleTaskSelect(task.id, columnName, position, e)
                              } else {
                                vscode.postMessage({ command: 'kanbn.task', task: task.id })
                              }
                            }}
                            onContextMenu={(e) => { handleContextMenu(e, task, columnName) }}
                          >
                            <span className="kanbn-list-col kanbn-list-col-name" title={task.id}>{task.name}</span>
                            <span className="kanbn-list-col kanbn-list-col-priority">
                              {task.metadata?.priority != null && task.metadata.priority !== '' && (
                                <span className={`kanbn-task-tag kanbn-task-priority kanbn-task-priority-${String(task.metadata.priority).toLowerCase().replace(/\s+/g, '-')}`}>
                                  {task.metadata.priority}
                                </span>
                              )}
                            </span>
                            <span className="kanbn-list-col kanbn-list-col-tags">
                              {(task.metadata?.tags ?? []).map((tag: string) => (
                                <span
                                  key={tag}
                                  className="kanbn-task-tag kanbn-task-tag-clickable"
                                  onClick={(e) => { e.stopPropagation(); handleTagClick(tag) }}
                                  title={`Filter by tag: ${tag}`}
                                >
                                  {tag}
                                </span>
                              ))}
                            </span>
                            <span className="kanbn-list-col kanbn-list-col-progress">
                              {taskProgress != null && taskProgress > 0
                                ? `${Math.round(taskProgress * 100)}%`
                                : ''}
                            </span>
                            <span className="kanbn-list-col kanbn-list-col-date">{displayDate}</span>
                          </div>
                        )
                      })}
                    </div>
                      )
                    : (
                    <Droppable droppableId={columnName} key={columnName}>
                      {(provided, snapshot) => {
                        const isDraggingOver: boolean = snapshot.isDraggingOver
                        return (
                          <div
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                            className={[
                              'kanbn-column-task-list',
                              isDraggingOver ? 'drag-over' : null
                            ].filter(i => i).join(' ')}
                          >
                            {filteredTasks.map((task, position) => <TaskItem
                              key={task.id}
                              task={task}
                              columnName={columnName}
                              customFields={state.customFields}
                              position={position}
                              dateFormat={state.dateFormat}
                              isSelected={selectedTaskIds.has(task.id)}
                              selectedCount={selectedTaskIds.size}
                              onSelect={handleTaskSelect}
                              onTagClick={handleTagClick}
                              onContextMenu={handleContextMenu}
                              isCompletedColumn={state.completedColumns.includes(columnName)}
                            />)}
                            {provided.placeholder}
                          </div>
                        )
                      }}
                    </Droppable>
                      )}
                </div>
              </div>
            )
          })}
        </DragDropContext>
      </div>
      {contextMenu !== null && (() => {
        // Viewport-clamp the menu position
        const menuWidth = 220
        const menuHeight = 320
        const x = Math.min(contextMenu.x, window.innerWidth - menuWidth - 8)
        const y = Math.min(contextMenu.y, window.innerHeight - menuHeight - 8)
        return (
          <div
            className="kanbn-context-menu"
            style={{ left: x, top: y }}
            onClick={(e) => { e.stopPropagation() }}
          >
            {contextMenu.submenu === null && (
              <>
                <button className="kanbn-context-menu-item" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: 'priority' } : null) }}>
                  Priority <span className="kanbn-context-menu-arrow">▶</span>
                </button>
                <button className="kanbn-context-menu-item" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: 'column' } : null) }}>
                  Move to <span className="kanbn-context-menu-arrow">▶</span>
                </button>
                <div className="kanbn-context-menu-separator" />
                <button className="kanbn-context-menu-item" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: 'progress' } : null) }}>
                  Set Progress
                </button>
                <button className="kanbn-context-menu-item" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: 'dates' } : null) }}>
                  Set Dates
                </button>
                <div className="kanbn-context-menu-separator" />
                <button className="kanbn-context-menu-item" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: 'tags' } : null) }}>
                  Tags <span className="kanbn-context-menu-arrow">▶</span>
                </button>
                <div className="kanbn-context-menu-separator" />
                <button className="kanbn-context-menu-item" onClick={() => {
                  const taskPath = state.kanbnFolder !== ''
                    ? `${state.kanbnFolder}/.kanbn/tasks/${contextMenu.task.id}.md`
                    : `.kanbn/tasks/${contextMenu.task.id}.md`
                  const text = `Task: ${contextMenu.task.name}\nTask path: ${taskPath}`
                  void navigator.clipboard.writeText(text)
                  setContextMenu(null)
                }}>
                  Copy T+P
                </button>
              </>
            )}

            {contextMenu.submenu === 'priority' && (
              <>
                <button className="kanbn-context-menu-item kanbn-context-menu-back" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: null } : null) }}>
                  ◀ Priority
                </button>
                <div className="kanbn-context-menu-separator" />
                {['Urgent', 'High', 'Medium', 'Low', 'Lowest'].map(p => (
                  <button key={p} className="kanbn-context-menu-item" onClick={() => {
                    vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { priority: p } })
                    setContextMenu(null)
                  }}>
                    <span className={`kanbn-context-priority-dot kanbn-context-priority-${p.toLowerCase()}`} />
                    {p}
                    {contextMenu.task.metadata?.priority === p && ' ✓'}
                  </button>
                ))}
                <button className="kanbn-context-menu-item" onClick={() => {
                  vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { priority: '' } })
                  setContextMenu(null)
                }}>
                  Clear priority
                </button>
              </>
            )}

            {contextMenu.submenu === 'column' && (
              <>
                <button className="kanbn-context-menu-item kanbn-context-menu-back" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: null } : null) }}>
                  ◀ Move to
                </button>
                <div className="kanbn-context-menu-separator" />
                {Object.keys(state.columns).map(col => (
                  <button key={col} className="kanbn-context-menu-item" onClick={() => {
                    vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { column: col } })
                    setContextMenu(null)
                  }}>
                    {col}
                    {col === contextMenu.columnName && ' ✓'}
                  </button>
                ))}
              </>
            )}

            {contextMenu.submenu === 'progress' && (
              <>
                <button className="kanbn-context-menu-item kanbn-context-menu-back" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: null } : null) }}>
                  ◀ Progress
                </button>
                <div className="kanbn-context-menu-separator" />
                <div className="kanbn-context-menu-input-row">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="10"
                    defaultValue={Math.round((contextMenu.task.progress ?? 0) * 100)}
                    className="kanbn-context-menu-input"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const value = Number((e.target as HTMLInputElement).value) / 100
                        vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { progress: value } })
                        setContextMenu(null)
                      }
                    }}
                  />
                  <span className="kanbn-context-menu-input-label">%</span>
                </div>
              </>
            )}

            {contextMenu.submenu === 'dates' && (
              <>
                <button className="kanbn-context-menu-item kanbn-context-menu-back" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: null } : null) }}>
                  ◀ Dates
                </button>
                <div className="kanbn-context-menu-separator" />
                <div className="kanbn-context-menu-date-row">
                  <label className="kanbn-context-menu-date-label">Started:</label>
                  <input
                    type="date"
                    className="kanbn-context-menu-input"
                    defaultValue={contextMenu.task.metadata?.started != null ? new Date(contextMenu.task.metadata.started).toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                      vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { started: e.target.value !== '' ? e.target.value : null } })
                    }}
                  />
                </div>
                <div className="kanbn-context-menu-date-row">
                  <label className="kanbn-context-menu-date-label">Due:</label>
                  <input
                    type="date"
                    className="kanbn-context-menu-input"
                    defaultValue={contextMenu.task.metadata?.due != null ? new Date(contextMenu.task.metadata.due).toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                      vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { due: e.target.value !== '' ? e.target.value : null } })
                    }}
                  />
                </div>
              </>
            )}

            {contextMenu.submenu === 'tags' && (
              <>
                <button className="kanbn-context-menu-item kanbn-context-menu-back" onClick={() => { setContextMenu(prev => prev != null ? { ...prev, submenu: null } : null) }}>
                  ◀ Tags
                </button>
                <div className="kanbn-context-menu-separator" />
                {(contextMenu.task.metadata?.tags ?? []).map((tag: string) => (
                  <button key={tag} className="kanbn-context-menu-item" onClick={() => {
                    const newTags = (contextMenu.task.metadata?.tags ?? []).filter((t: string) => t !== tag)
                    vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { tags: newTags } })
                    setContextMenu(prev => prev != null ? { ...prev, task: { ...prev.task, metadata: { ...prev.task.metadata, tags: newTags } } } : null)
                  }}>
                    <span className="kanbn-context-menu-tag-remove">✕</span> {tag}
                  </button>
                ))}
                <div className="kanbn-context-menu-input-row">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    className="kanbn-context-menu-input"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const newTag = (e.target as HTMLInputElement).value.trim()
                        if (newTag !== '') {
                          const newTags = [...(contextMenu.task.metadata?.tags ?? []), newTag]
                          vscode.postMessage({ command: 'kanbn.quickUpdate', taskId: contextMenu.task.id, updates: { tags: newTags } })
                          setContextMenu(prev => prev != null ? { ...prev, task: { ...prev.task, metadata: { ...prev.task.metadata, tags: newTags } } } : null)
                          ;(e.target as HTMLInputElement).value = ''
                        }
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )
      })()}
    </>
  )
}

export default Board
