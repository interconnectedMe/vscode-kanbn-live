import React from 'react'
import { Draggable } from 'react-beautiful-dnd'
import formatDate from 'dateformat'
import { paramCase } from '@basementuniverse/kanbn/src/utility'
import vscode from './vscode'

// Parse date strings, handling DD/MM/YYYY format that JavaScript misinterprets as MM/DD/YYYY
const parseDate = (value: any): Date | null => {
  if (value == null) return null
  const s = String(value)
  // Match DD/MM/YYYY (1-2 digit day and month, 4-digit year)
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch != null) {
    const day = parseInt(slashMatch[1], 10)
    const month = parseInt(slashMatch[2], 10)
    const year = parseInt(slashMatch[3], 10)
    return new Date(year, month - 1, day)
  }
  // For ISO or other formats, let Date parse normally
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d
}

const TaskItem = ({ task, columnName, customFields, position, dateFormat, isSelected, selectedCount, onSelect, onTagClick, onContextMenu, isCompletedColumn }: {
  task: KanbnTask
  columnName: string
  customFields: Array<{ name: string, type: 'boolean' | 'date' | 'number' | 'string' }>
  position: number
  dateFormat: string
  isSelected: boolean
  selectedCount: number
  onSelect: (taskId: string, columnName: string, position: number, e: React.MouseEvent) => void
  onTagClick: (tag: string) => void
  onContextMenu: (e: React.MouseEvent, task: KanbnTask, columnName: string) => void
  isCompletedColumn: boolean
}): JSX.Element => {
  const safeFmt = (v: any): string | null => {
    const d = parseDate(v)
    return d != null ? formatDate(d, dateFormat) : null
  }
  const createdDate = 'created' in task.metadata ? safeFmt(task.metadata.created) : null
  const updatedDate = 'updated' in task.metadata ? safeFmt(task.metadata.updated) : null
  const startedDate = 'started' in task.metadata ? safeFmt(task.metadata.started) : null
  const dueDate = 'due' in task.metadata ? safeFmt(task.metadata.due) : null
  const completedDate = 'completed' in task.metadata ? safeFmt(task.metadata.completed) : null

  // Check if a task's due date is in the past
  const checkOverdue = (task: KanbnTask): boolean => {
    if ('due' in task.metadata && task.metadata.due !== undefined) {
      const d = parseDate(task.metadata.due)
      return d != null && d.getTime() < (new Date()).getTime()
    }
    return false
  }

  return (
    <Draggable
      key={task.id}
      draggableId={task.id}
      index={position}
    >
      {(provided, snapshot) => {
        const isDragging: boolean = snapshot.isDragging
        const dragHandleProps = provided.dragHandleProps ?? {}
        const originalOnMouseDown = dragHandleProps.onMouseDown
        return (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...dragHandleProps}
            onContextMenu={(e) => { onContextMenu(e, task, columnName) }}
            onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
              // When Ctrl/Shift is held, handle selection instead of drag
              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                e.preventDefault()
                e.stopPropagation()
                onSelect(task.id, columnName, position, e)
                return
              }
              // Let react-beautiful-dnd handle the drag (including multi-drag for selected cards)
              if (originalOnMouseDown != null) {
                originalOnMouseDown(e as any)
              }
            }}
            className={[
              'kanbn-task',
              // TODO: remove the explicit String cast once typescript bindings for kanbn are updated
              `kanbn-task-column-${String(paramCase(columnName))}`,
              checkOverdue(task) ? 'kanbn-task-overdue' : null,
              completedDate ?? 'kanbn-task-completed',
              isDragging ? 'drag' : null,
              isSelected ? 'kanbn-task-selected' : null,
              isCompletedColumn ? 'kanbn-task-in-completed-column' : null
            ].filter(i => i).join(' ')}
            style={{
              userSelect: 'none',
              ...provided.draggableProps.style
            }}
          >
            {isDragging && isSelected && selectedCount > 1 &&
              <span className="kanbn-multi-drag-badge">{selectedCount}</span>
            }
            <div className="kanbn-task-data kanbn-task-data-name">
              <button
                type="button"
                onClick={() => {
                  vscode.postMessage({
                    command: 'kanbn.task',
                    taskId: task.id,
                    columnName: task.column
                  })
                }}
                title={task.id}
              >
                {task.name}
              </button>
            </div>
            {
              task.metadata.priority != null &&
              task.metadata.priority !== '' &&
              <div className="kanbn-task-data kanbn-task-data-tags">
                <span className={`kanbn-task-tag kanbn-task-priority kanbn-task-priority-${String(paramCase(task.metadata.priority))}`}>
                  {task.metadata.priority}
                </span>
              </div>
            }
            {
              task.metadata.tags !== undefined &&
              task.metadata.tags.length > 0 &&
              <div className="kanbn-task-data kanbn-task-data-tags">
                {task.metadata.tags.map(tag => {
                  return (
                    <span
                      key={tag}
                      className={[
                        'kanbn-task-tag',
                        'kanbn-task-tag-clickable',
                        // TODO: remove the explicit String cast once typescript bindings for kanbn are updated
                        `kanbn-task-tag-${String(paramCase(tag))}`
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation()
                        onTagClick(tag)
                      }}
                      title={`Filter by tag: ${tag}`}
                    >
                      {tag}
                    </span>
                  )
                })}
              </div>
            }
            {
              customFields.map(customField => {
                if (customField.name in task.metadata) {
                  return (
                    <div key={customField.name} className={[
                      'kanbn-task-data kanbn-task-data-custom-field',
                      // TODO: remove the explicit String cast once typescript bindings for kanbn are updated
                      `kanbn-task-data-${String(paramCase(customField.name))}`
                    ].join(' ')}>
                      {
                        customField.type === 'boolean'
                          ? (
                            <>
                              <i className={`codicon codicon-${task.metadata[customField.name] !== undefined
                                ? 'pass-filled'
                                : 'circle-large-outline'}`}></i>
                              {customField.name}
                            </>
                            )
                          : (
                            <>
                              <i className="codicon codicon-json"></i>
                              <span title={customField.name}>
                                {customField.type === 'date'
                                  ? (safeFmt(task.metadata[customField.name]) ?? task.metadata[customField.name])
                                  : task.metadata[customField.name]}
                              </span>
                            </>
                            )
                      }
                    </div>
                  )
                }
                return (<></>)
              })
            }
            {
              'assigned' in task.metadata &&
              (task.metadata.assigned != null) &&
              <div className="kanbn-task-data kanbn-task-data-assigned">
                <i className="codicon codicon-account"></i>{task.metadata.assigned}
              </div>
            }
            {
              (createdDate != null) &&
              <div className="kanbn-task-data kanbn-task-data-created" title={`Created ${createdDate}`}>
                <i className="codicon codicon-clock"></i>{createdDate}
              </div>
            }
            {
              (updatedDate != null) &&
              <div className="kanbn-task-data kanbn-task-data-updated" title={`Updated ${updatedDate}`}>
                <i className="codicon codicon-clock"></i>{updatedDate}
              </div>
            }
            {
              (startedDate != null) &&
              <div className="kanbn-task-data kanbn-task-data-started" title={`Started ${startedDate}`}>
                <i className="codicon codicon-run"></i>{startedDate}
              </div>
            }
            {
              (dueDate != null) &&
              <div className="kanbn-task-data kanbn-task-data-due" title={`Due ${dueDate}`}>
                <i className="codicon codicon-watch"></i>{dueDate}
              </div>
            }
            {
              (completedDate != null) &&
              <div className="kanbn-task-data kanbn-task-data-completed" title={`Completed ${completedDate}`}>
                <i className="codicon codicon-check"></i>{completedDate}
              </div>
            }
            {
              task.metadata?.recurrence != null &&
              <div
                className="kanbn-task-data kanbn-task-data-recurrence"
                title={`Recurs every ${task.metadata.recurrence.interval ?? 1} ${task.metadata.recurrence.type}`}
              >
                <i className="codicon codicon-sync"></i>
              </div>
            }
            {
              task.comments.length > 0 &&
              <div className="kanbn-task-data kanbn-task-data-comments">
                <i className="codicon codicon-comment"></i>{task.comments.length}
              </div>
            }
            {
              task.subTasks.length > 0 &&
              <div className="kanbn-task-data kanbn-task-data-sub-tasks">
                <i className="codicon codicon-tasklist"></i>
                {task.subTasks.filter(subTask => subTask.completed).length} / {task.subTasks.length}
              </div>
            }
            {
              task.workload !== undefined &&
              <div className="kanbn-task-data kanbn-task-data-workload">
                <i className="codicon codicon-run"></i>{task.workload}
              </div>
            }
            {
              task.relations.length > 0 &&
              task.relations.map(relation => (
                <div key={relation.task} className={[
                  'kanbn-task-data kanbn-task-data-relation',
                  relation.type !== '' ? `kanbn-task-data-relation-${relation.type}` : null
                ].join(' ')}>
                  <i className="codicon codicon-link"></i>
                  <span className="kanbn-task-data-label">
                    {relation.type}
                  </span> {relation.task}
                </div>
              ))
            }
            {
              task.progress !== undefined &&
              task.progress > 0 &&
              <div className="kanbn-task-progress" style={{
                width: `${Math.min(1, Math.max(0, task.progress)) * 100}%`
              }}></div>
            }
          </div>
        )
      }}
    </Draggable>
  )
}

export default TaskItem
