// Note that Date properties will be converted to strings (ISO) when a task is serialized and passed as a prop
declare interface KanbnTask {
  id: string
  name: string
  description: string
  column: string
  workload?: number
  remainingWorkload?: number
  progress?: number
  metadata: {
    created?: string
    updated?: string
    started?: string
    due?: string
    completed?: string
    assigned?: string
    priority?: string
    tags?: string[]
    attachments?: Array<{ type: string, path?: string, url?: string, title: string }>
    recurrence?: {
      type: string
      interval: number
      dayOfMonth?: number
    }
    [key: string]: any
  }
  relations: Array<{
    type: string
    task: string
  }>
  subTasks: Array<{
    text: string
    completed: boolean
  }>
  comments: Array<{
    author: string
    date: string
    text: string
  }>
}
