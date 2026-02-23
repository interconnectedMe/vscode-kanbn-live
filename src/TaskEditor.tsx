/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import React, { useEffect, useState, useCallback } from 'react'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import formatDate from 'dateformat'
import vscode from './vscode'
import { paramCase } from '@basementuniverse/kanbn/src/utility'
import ReactMarkdown from 'react-markdown'
// import TextareaAutosize from 'react-textarea-autosize'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import 'katex/dist/katex.min.css'

const Markdown = (props): JSX.Element => {
  const components = {
    code ({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className ?? '')
      return inline !== false && (match != null)
        ? (
      <SyntaxHighlighter
        style={{}}
        useInlineStyles={false}
        language={match[1]}
        PreTag="div"
        {...props}>
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
          )
        : (
      <code className={className} {...props}>
        {children}
      </code>
          )
    }
  }

  return (<ReactMarkdown {...{
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    components,
    ...props
  }} />)
}

const EditableMarkdown = ({ formMethods, inputName, multiline, markdownClassnames, inputClassnames, inputId, defaultValue, tabIndex }: any): JSX.Element => {
  const { register, watch } = formMethods
  const [isFocused, setIsFocused] = useState(false)
  const markdown = watch(inputName, defaultValue ?? '')

  const handleFocus = (): void => {
    setIsFocused(true)
  }

  const handleBlur = (): void => {
    setIsFocused(false)
  }

  return (
    <div>
      {isFocused
        ? (
            multiline
              ? <textarea
          {...register(inputName)}
          onBlur={handleBlur}
          autoFocus={true}
          id={inputId}
          className={inputClassnames}
        />
              : <input
          {...register(inputName)}
          onBlur={handleBlur}
          autoFocus={true}
          id={inputId}
          className={inputClassnames}
        />
          )
        : (
        <div
          onClick={() => handleFocus()}
          onFocus={() => handleFocus()}
          onKeyDown={(e) => { if (e.key === 'Enter') handleFocus() }}
          tabIndex={tabIndex ?? 0}
          className={markdownClassnames}
        >
          <Markdown>{markdown as string}</Markdown>
        </div>
          )}
    </div>
  )
}

interface CustomField {
  name: string
  type: string
  value: any
}

interface SubTask {
  text: string
  completed: boolean
}

interface Relation {
  task: string
  type: string
}

interface Comment {
  author: string
  date: Date
  text: string
}

interface Tag {
  tag: string
}

interface Attachment {
  type: 'file' | 'link'
  path?: string
  url?: string
  title: string
}

interface EditorState {
  name: string
  description: string
  subTasks: SubTask[]
  relations: Relation[]
  comments: Comment[]
  attachments: Attachment[]
  column: string
  priority: string
  assignedTo: string
  startedDate: string | null
  dueDate: string | null
  completedDate: string | null
  tags: Tag[]
  progress: number
  customFields: CustomField[]
  recurrenceType: string
  recurrenceInterval: number
  recurrenceDayOfMonth: number
}

interface Task {
  id: string
}

interface TaskState {
  name: string
  dateFormat: string
  taskCreated: boolean
  tasks: Record<string, Task>
  columnNames: string[]
  createdDate: Date | null
  updatedDate: Date | null
  customFields: CustomField[]
  taskPath: string | null
}

// vscode state is task data as shown in the form, and the state of the form
// react state is all the other stuff, like the available columnNames, tasks, task, dateFormat, name.
const TaskEditor = (): JSX.Element => {
  // vscode state will store the form data when the editor is hidden
  const [state, setState] = useState<TaskState | null>(null)

  // Called when the form is submitted
  const handleTaskSave = (values: EditorState): void => {
    const newValues = {
      ...values,
      id: paramCase(values.name ?? ''),
      createdDate: state?.createdDate
    }
    vscode.postMessage({
      command: 'kanbn.updateOrCreate',
      taskData: newValues
    })
  }
  // Called when the delete task button is clicked
  const handleRemoveTask = (): void => {
    vscode.postMessage({
      command: 'kanbn.delete'
    })
  }

  // Called when the archive task button is clicked
  const handleArchiveTask = (): void => {
    vscode.postMessage({
      command: 'kanbn.archive'
    })
  }

  // Validate form data
  const validateName = (name: string): boolean => {
    if (state === null) { return false }
    if (paramCase(name ?? '') in state.tasks && paramCase(name ?? '') !== paramCase(state.name ?? '')) { return false }
    return true
  }

  useEffect(() => {
    vscode.postMessage({
      command: 'kanbn.updateMe'
    })
  }, [])

  // TODO: the default values can probably be set from the KanbnTaskPanel object,
  // since we can pass it a future the panel can resolve
  const vscodeState = vscode.getState()
  const [shouldUpdateEditorState, setShouldUpdateEditorState] = useState(vscodeState === undefined)
  const {
    control,
    watch,
    reset,
    register,
    handleSubmit,
    formState: { isDirty, isValid }
  } = vscodeState !== undefined ? useForm<EditorState>({ defaultValues: vscodeState }) : useForm<EditorState>()

  const {
    fields: commentFields,
    append: appendComment,
    remove: removeComment
  } = useFieldArray({
    control, // control props comes from useForm (optional: if you are using FormContext)
    name: 'comments' // unique name for your Field Array
  })
  // subtasks
  const {
    fields: subtaskFields,
    append: appendSubtask,
    remove: removeSubtask
  } = useFieldArray({
    control,
    name: 'subTasks'
  })
  // relations
  const {
    fields: relationFields,
    append: appendRelation,
    remove: removeRelation
  } = useFieldArray({
    control,
    name: 'relations'
  })
  // tags
  const {
    fields: tagFields,
    append: appendTag,
    remove: removeTag
  } = useFieldArray({
    control,
    name: 'tags'
  })

  // attachments
  const {
    fields: attachmentFields,
    append: appendAttachment,
    remove: removeAttachment
  } = useFieldArray({
    control,
    name: 'attachments'
  })

  const {
    fields: customFields
  } = useFieldArray({
    control,
    name: 'customFields'
  })

  const watchedProgress = useWatch({
    control,
    name: 'progress'
  })
  const watchedDue = useWatch({
    control,
    name: 'dueDate'
  })
  const watchedRecurrenceType = useWatch({
    control,
    name: 'recurrenceType'
  })

  // Check if a task's due date is in the past
  const checkOverdue = (): boolean => {
    if (watchedDue != null) {
      return new Date(watchedDue) < new Date()
    }
    return false
  }

  const processMessage = useCallback(event => {
    // Handle file attachment response from extension host
    if (event.data.command === 'fileAttached') {
      appendAttachment({
        type: 'file',
        path: event.data.fileName,
        url: '',
        title: event.data.title
      })
      return
    }

    // Ignore messages without index data (non-update messages)
    if (event.data.index == null) return

    const tasks = Object.fromEntries((event.data.tasks ?? []).map(task => [task.id, task]))
    const newState: TaskState = {
      // TODO: Not sure yet if name is necessary. Definitely won't be necessary in the future
      name: event.data.task?.name ?? '',
      taskCreated: event.data.task !== null,
      tasks,
      columnNames: Object.keys(event.data.index.columns),
      // TODO: might be able to get this directly from a configuration
      dateFormat: event.data.dateFormat,
      createdDate: event.data.task?.metadata?.created ?? null,
      updatedDate: event.data.task?.metadata?.updated ?? null,
      customFields: event.data.customFields ?? [],
      taskPath: event.data.taskPath ?? null
    }
    setState(newState)
    if (shouldUpdateEditorState) {
      setShouldUpdateEditorState(false)
      function formatDateString (dateString: string | null): string | null {
        if (dateString === null) {
          return null
        }
        const date = new Date(dateString)
        const year = date.getFullYear()
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const day = date.getDate().toString().padStart(2, '0')

        return `${year}-${month}-${day}`
      }
      reset(
        {
          name: event.data.task?.name ?? '',
          description: event.data.task?.description ?? '',
          column: event.data.columnName,
          priority: event.data.task?.metadata?.priority ?? '',
          progress: event.data.task?.metadata?.progress ?? 0,
          relations: event.data.task?.relations ?? [],
          subTasks: event.data.task?.subTasks ?? [],
          comments: event.data.task?.comments ?? [],
          attachments: (event.data.attachments ?? []).map((att: any) => ({
            type: att.type ?? 'link',
            path: att.path ?? '',
            url: att.url ?? '',
            title: att.title ?? ''
          })),
          customFields: event.data.customFields?.map((customField: { name: string, type: string }) => ({ ...customField, value: (customField.type === 'date' ? formatDateString(event.data.task?.metadata[customField.name]) : event.data.task?.metadata[customField.name]) })) ?? [],
          tags: event.data.task?.metadata?.tags.map((tag: string): Tag => ({ tag })) ?? [],
          dueDate: formatDateString(event.data.task?.metadata?.due),
          startedDate: formatDateString(event.data.task?.metadata?.started),
          completedDate: formatDateString(event.data.task?.metadata?.completed),
          assignedTo: event.data.task?.metadata?.assigned ?? '',
          recurrenceType: event.data.task?.metadata?.recurrence?.type ?? 'none',
          recurrenceInterval: event.data.task?.metadata?.recurrence?.interval ?? 1,
          recurrenceDayOfMonth: event.data.task?.metadata?.recurrence?.dayOfMonth ?? 1
        }
      )
    }
  }, [])

  useEffect(() => {
    window.addEventListener('message', processMessage)
    return () => {
      window.removeEventListener('message', processMessage)
    }
  })

  const formData = watch()
  // Store the form state whenever it changes
  useEffect(() => {
    vscode.setState(formData)
  }, [formData])

  const [copyTpStatus, setCopyTpStatus] = useState<string | null>(null)
  const handleCopyTp = (): void => {
    const taskName = formData.name ?? state?.name ?? ''
    const taskPath = state?.taskPath ?? ''
    const text = `Task: ${taskName}\nTask path: ${taskPath}`
    void navigator.clipboard.writeText(text).then(() => {
      setCopyTpStatus('Copied!')
      setTimeout(() => { setCopyTpStatus(null) }, 2000)
    })
  }

  if (state === null || shouldUpdateEditorState) {
    return <div className="kanbn-task-editor">Loading...</div>
  }
  return (
    <div className="kanbn-task-editor">
      <form onSubmit={handleSubmit(handleTaskSave)}>
        <h1 className="kanbn-task-editor-title">
          {state.taskCreated ? 'Update task' : 'Create new task'}
          {isDirty && <span className="kanbn-task-editor-dirty">*</span>}
        </h1>
        <div className="kanbn-task-editor-buttons kanbn-task-editor-main-buttons">
          {state.taskCreated && <button
            type="button"
            className="kanbn-task-editor-button kanbn-task-editor-button-delete"
            title="Delete task"
            onClick={() => {
              handleRemoveTask()
            }}
          >
            <i className="codicon codicon-trash"></i>Delete
          </button>}
          {state.taskCreated && <button
            type="button"
            className="kanbn-task-editor-button kanbn-task-editor-button-archive"
            title="Archive task"
            onClick={() => {
              handleArchiveTask()
            }}
          >
            <i className="codicon codicon-archive"></i>Archive
          </button>}
          <button
            type="submit"
            className="kanbn-task-editor-button kanbn-task-editor-button-submit"
            title="Save task"
            disabled={!isValid}
          >
            <i className="codicon codicon-save"></i>Save
          </button>
        </div>
        {state.taskCreated && <span className="kanbn-task-editor-dates">
          {
            [
              state.createdDate ? `Created ${formatDate(state.createdDate, state.dateFormat)}` : null,
              state.updatedDate ? `Updated ${formatDate(state.updatedDate, state.dateFormat)}` : null
            ].filter(i => i).join(', ')
          }
        </span>}
        <div className="kanbn-task-editor-form">
          <div className="kanbn-task-editor-column-left">
            <div className="kanbn-task-editor-field kanbn-task-editor-field-name">
              <label className="kanbn-task-editor-field-label">
                <p>Name</p>
                <input
                  {...register('name', { required: true, validate: validateName })}
                  className="kanbn-task-editor-field-input"
                  placeholder="Name"
                  tabIndex={1}
                  autoFocus={!state.taskCreated}
                />
              </label>
              <div className="kanbn-task-editor-id">{(paramCase(state.name ?? ''))}</div>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-description">
              <label
                className="kanbn-task-editor-field-label kanbn-task-editor-field-label-description"
                htmlFor="description-input"
              >
                <p>Description</p>
              </label>
              {state.taskCreated && state.taskPath != null &&
                <button
                  type="button"
                  className="kanbn-task-editor-button kanbn-task-editor-button-copy-tp"
                  title="Copy Task name + path to clipboard"
                  onClick={handleCopyTp}
                >
                  <i className="codicon codicon-copy"></i>
                  {copyTpStatus != null ? copyTpStatus : 'Copy T+P'}
                </button>
              }
              <EditableMarkdown
                formMethods={{ watch, register }}
                inputName='description'
                multiline={true}
                markdownClassnames="kanbn-task-editor-description-preview"
                inputId="description-input"
                inputClassnames="kanbn-task-editor-field-textarea"
                tabIndex={2}
              />
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-subtasks">
              <h2 className="kanbn-task-editor-title">Sub-tasks</h2>
              <div>
                {subtaskFields.map((subTask: SubTask, index) => (
                  <div className="kanbn-task-editor-row kanbn-task-editor-row-subtask" key={index}>
                    <div className="kanbn-task-editor-column kanbn-task-editor-field-subtask-completed">
                      <input
                        {...register(`subTasks.${index}.completed`)}
                        className="kanbn-task-editor-field-checkbox"
                        type="checkbox"
                      />
                    </div>
                    <div className="kanbn-task-editor-column kanbn-task-editor-field-subtask-text">
                      <input
                        {...register(`subTasks.${index}.text`)}
                        className="kanbn-task-editor-field-input"
                        placeholder="Sub-task text"
                      />
                    </div>
                    <div className="kanbn-task-editor-column kanbn-task-editor-column-buttons">
                      <button
                        type="button"
                        className="kanbn-task-editor-button kanbn-task-editor-button-delete"
                        title="Remove sub-task"
                        onClick={() => removeSubtask(index)}
                      >
                        <i className="codicon codicon-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
                <div className="kanbn-task-editor-buttons">
                  <button
                    type="button"
                    className="kanbn-task-editor-button kanbn-task-editor-button-add"
                    title="Add sub-task"
                    onClick={() => appendSubtask({ completed: false, text: '' })}
                  >
                    <i className="codicon codicon-tasklist"></i>Add sub-task
                  </button>
                </div>
              </div>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-relations">
              <h2 className="kanbn-task-editor-title">Relations</h2>
              <div>
                {relationFields.map((relation: Relation, index) => (
                  <div className="kanbn-task-editor-row kanbn-task-editor-row-relation" key={index}>
                    <div className="kanbn-task-editor-column kanbn-task-editor-field-relation-type">
                      <input
                        {...register(`relations.${index}.type`)}
                        className="kanbn-task-editor-field-input"
                        defaultValue={relation.type}
                        placeholder="Relation type"
                      />
                    </div>
                    <div className="kanbn-task-editor-column kanbn-task-editor-field-relation-task">
                      <select
                        {...register(`relations.${index}.task`)}
                        className="kanbn-task-editor-field-select"
                      >
                        {Object.keys(state.tasks).map(t => <option key={state.tasks[t].id} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="kanbn-task-editor-column kanbn-task-editor-column-buttons">
                      <button
                        type="button"
                        className="kanbn-task-editor-button kanbn-task-editor-button-delete"
                        title="Remove relation"
                        onClick={() => removeRelation(index)}
                      >
                        <i className="codicon codicon-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
                <div className="kanbn-task-editor-buttons">
                  <button
                    type="button"
                    className="kanbn-task-editor-button kanbn-task-editor-button-add"
                    title="Add relation"
                    onClick={() => appendRelation({ type: '', task: '' })}
                  >
                    <i className="codicon codicon-link"></i>Add relation
                  </button>
                </div>
              </div>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-comments">
              <h2 className="kanbn-task-editor-title">Comments</h2>
              <div>
                {commentFields.map((comment: Comment, index) => (
                  <div className="kanbn-task-editor-row-comment" key={index}>
                    <div className="kanbn-task-editor-row">
                      <div className="kanbn-task-editor-column kanbn-task-editor-field-comment-author">
                        {
                          <label className="kanbn-task-editor-field-label">
                            <p>Author</p>
                            <input
                              {...register(`comments.${index}.author`)}
                              className="kanbn-task-editor-field-input"
                              placeholder="Comment author"
                            />
                          </label>
                        }
                      </div>
                      <div className="kanbn-task-editor-column kanbn-task-editor-field-comment-date">
                        {formatDate(comment.date, state.dateFormat)}
                      </div>
                      <div className="kanbn-task-editor-column kanbn-task-editor-column-buttons">
                        <button
                          type="button"
                          className="kanbn-task-editor-button kanbn-task-editor-button-delete"
                          title="Remove comment"
                          onClick={() => removeComment(index)}
                        >
                          <i className="codicon codicon-trash"></i>
                        </button>
                      </div>
                    </div>
                    <div className="kanbn-task-editor-row">
                      <div className="kanbn-task-editor-column kanbn-task-editor-field-comment-text">
                        <EditableMarkdown
                          formMethods={{ watch, register }}
                          inputName={`comments.${index}.text`}
                          multiline={true}
                          markdownClassnames="kanbn-task-editor-comment-text"
                          inputClassnames="kanbn-task-editor-field-textarea"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="kanbn-task-editor-buttons">
                  <button
                    type="button"
                    className="kanbn-task-editor-button kanbn-task-editor-button-add"
                    title="Add comment"
                    onClick={() => {
                      appendComment({ text: '', date: new Date(), author: '' })
                    }}
                  >
                    <i className="codicon codicon-comment"></i>Add comment
                  </button>
                </div>
              </div>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-attachments">
              <h2 className="kanbn-task-editor-title">Attachments</h2>
              <div>
                {attachmentFields.map((attachment: any, index) => (
                  <div className="kanbn-task-editor-row kanbn-task-editor-row-attachment" key={index}>
                    <div className="kanbn-task-editor-column kanbn-task-editor-field-attachment-icon">
                      <i className={`codicon ${attachment.type === 'file' ? 'codicon-file' : 'codicon-link-external'}`}></i>
                    </div>
                    <div className="kanbn-task-editor-column kanbn-task-editor-field-attachment-title">
                      <input
                        {...register(`attachments.${index}.title`)}
                        className="kanbn-task-editor-field-input"
                        placeholder="Title"
                      />
                    </div>
                    {attachment.type === 'link' && (
                      <div className="kanbn-task-editor-column kanbn-task-editor-field-attachment-url">
                        <input
                          {...register(`attachments.${index}.url`)}
                          className="kanbn-task-editor-field-input"
                          placeholder="URL or local path"
                        />
                      </div>
                    )}
                    <div className="kanbn-task-editor-column kanbn-task-editor-column-buttons">
                      <button
                        type="button"
                        className="kanbn-task-editor-button kanbn-task-editor-button-open"
                        title="Open attachment"
                        onClick={() => {
                          vscode.postMessage({
                            command: 'kanbn.openAttachment',
                            attachmentType: attachment.type,
                            path: attachment.path,
                            url: attachment.url
                          })
                        }}
                      >
                        <i className="codicon codicon-go-to-file"></i>
                      </button>
                      <button
                        type="button"
                        className="kanbn-task-editor-button kanbn-task-editor-button-delete"
                        title="Remove attachment"
                        onClick={() => removeAttachment(index)}
                      >
                        <i className="codicon codicon-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
                <div className="kanbn-task-editor-buttons">
                  <button
                    type="button"
                    className="kanbn-task-editor-button kanbn-task-editor-button-add"
                    title="Attach a file (copies to .kanbn/attachments/)"
                    onClick={() => {
                      vscode.postMessage({ command: 'kanbn.pickFile' })
                    }}
                  >
                    <i className="codicon codicon-file-add"></i>Add file
                  </button>
                  <button
                    type="button"
                    className="kanbn-task-editor-button kanbn-task-editor-button-add"
                    title="Add a URL or local file path reference"
                    onClick={() => {
                      appendAttachment({ type: 'link', path: '', url: '', title: '' })
                    }}
                  >
                    <i className="codicon codicon-link"></i>Add link
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="kanbn-task-editor-column-right">
            <div className="kanbn-task-editor-field kanbn-task-editor-field-column">
              <label className="kanbn-task-editor-field-label">
                <p>Column</p>
                <select
                  {...register('column')}
                  className="kanbn-task-editor-field-select"
                >
                  {state.columnNames.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-priority">
              <label className="kanbn-task-editor-field-label">
                <p>Priority</p>
                <select
                  {...register('priority')}
                  className="kanbn-task-editor-field-select"
                >
                  <option value="">None</option>
                  <option value="Urgent">Urgent</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                  <option value="Lowest">Lowest</option>
                </select>
              </label>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-recurrence">
              <label className="kanbn-task-editor-field-label">
                <p>Recurrence</p>
                <select
                  {...register('recurrenceType')}
                  className="kanbn-task-editor-field-select"
                >
                  <option value="none">None</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="annually">Annually</option>
                </select>
              </label>
            </div>
            {watchedRecurrenceType != null && watchedRecurrenceType !== 'none' && watchedRecurrenceType !== '' && (
              <>
                <div className="kanbn-task-editor-field kanbn-task-editor-field-recurrence-interval">
                  <label className="kanbn-task-editor-field-label">
                    <p>Every</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        {...register('recurrenceInterval', { valueAsNumber: true, min: 1, max: 365 })}
                        type="number"
                        min="1"
                        max="365"
                        className="kanbn-task-editor-field-input"
                        style={{ width: '60px' }}
                      />
                      <span>
                        {watchedRecurrenceType === 'daily'
                          ? 'day(s)'
                          : watchedRecurrenceType === 'weekly'
                            ? 'week(s)'
                            : watchedRecurrenceType === 'monthly'
                              ? 'month(s)'
                              : 'year(s)'}
                      </span>
                    </div>
                  </label>
                </div>
                {watchedRecurrenceType === 'monthly' && (
                  <div className="kanbn-task-editor-field kanbn-task-editor-field-recurrence-dom">
                    <label className="kanbn-task-editor-field-label">
                      <p>Day of month</p>
                      <input
                        {...register('recurrenceDayOfMonth', { valueAsNumber: true, min: 1, max: 31 })}
                        type="number"
                        min="1"
                        max="31"
                        className="kanbn-task-editor-field-input"
                        style={{ width: '60px' }}
                      />
                    </label>
                  </div>
                )}
              </>
            )}
            <div className="kanbn-task-editor-field kanbn-task-editor-field-assigned">
              <label className="kanbn-task-editor-field-label">
                <p>Assigned to</p>
                <input
                  {...register('assignedTo')}
                  className="kanbn-task-editor-field-input"
                />
              </label>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-started">
              <label className="kanbn-task-editor-field-label">
                <p>Started date</p>
                <input
                  {...register('startedDate')}
                  className="kanbn-task-editor-field-input"
                  type="date"
                />
              </label>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-due">
              <label className="kanbn-task-editor-field-label">
                <p>Due date</p>
                <input
                  {...register('dueDate')}
                  className={[
                    'kanbn-task-editor-field-input',
                    checkOverdue() ? 'kanbn-task-overdue' : null
                  ].filter(i => i).join(' ')}
                  type="date"
                />
              </label>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-completed">
              <label className="kanbn-task-editor-field-label">
                <p>Completed date</p>
                <input
                  {...register('completedDate')}
                  className="kanbn-task-editor-field-input"
                  type="date"
                />
              </label>
            </div>
            <div className="kanbn-task-editor-field kanbn-task-editor-field-progress">
              <label className="kanbn-task-editor-field-label">
                <p>Progress</p>
                <input
                  {...register('progress')}
                  className="kanbn-task-editor-field-input"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                />
                <div className="kanbn-task-progress" style={{
                  width: `${Math.min(1, Math.max(0, watchedProgress ?? 0)) * 100}%`
                }}></div>
              </label>
            </div>
            {
              customFields.map((customField: any, index) => (
                <div key={customField.id} className={[
                  'kanbn-task-editor-field kanbn-task-editor-custom-field',
                  `kanbn-task-editor-custom-field-${paramCase(customField?.name ?? '')}`
                ].join(' ')}>
                  <label className="kanbn-task-editor-field-label">
                    {customField.type === 'boolean'
                      ? (
                        <>
                          <input
                            {...register(`customFields.${index}.value`)}
                            className="kanbn-task-editor-field-input kanbn-task-editor-custom-checkbox"
                            type="checkbox"
                          /><p>{customField.name}</p>
                        </>
                        )
                      : (
                        <>
                          <p>{customField.name}</p>
                          <input
                            {...register(`customFields.${index}.value`)}
                            className="kanbn-task-editor-field-input"
                            type={customField.type}
                          />
                        </>
                        )}
                  </label>
                </div>
              ))
            }
            <div className="kanbn-task-editor-field kanbn-task-editor-field-tags">
              <label className="kanbn-task-editor-field-label">
                <p>Tags</p>
              </label>
              <div>
                {tagFields.map((tag: any, index) => (
                  <div className="kanbn-task-editor-row kanbn-task-editor-row-tag" key={index}>
                    <div className="kanbn-task-editor-column kanbn-task-editor-field-tag">
                      {/* TODO: fix this. I would expect tags to be selectable from a list specified for the particular board. */}
                      <input
                        {...register(`tags.${index}.tag`, { required: true })}
                        className="kanbn-task-editor-field-input"
                        placeholder="Tag name"
                      />
                      <div
                        className={[
                          'kanbn-task-editor-tag-highlight',
                          `kanbn-task-tag-${paramCase(tag.tag ?? '')}`
                        ].join(' ')}
                      ></div>
                    </div>
                    <div className="kanbn-task-editor-column kanbn-task-editor-column-buttons">
                      <button
                        type="button"
                        className="kanbn-task-editor-button kanbn-task-editor-button-delete"
                        title="Remove tag"
                        onClick={() => removeTag(index)}
                      >
                        <i className="codicon codicon-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
                <div className="kanbn-task-editor-buttons">
                  <button
                    type="button"
                    className="kanbn-task-editor-button kanbn-task-editor-button-add"
                    title="Add tag"
                    onClick={() => appendTag({ tag: '' })}
                  >
                    <i className="codicon codicon-tag"></i>Add tag
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

export default TaskEditor
