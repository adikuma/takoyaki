import { useState } from 'react'

interface ConfirmRemoveTaskState {
  id: string
  title: string
  detail?: string
  force: boolean
}

export function useTaskRemovalController() {
  const [confirmRemoveTask, setConfirmRemoveTask] = useState<ConfirmRemoveTaskState | null>(null)
  const [taskRemoveBusy, setTaskRemoveBusy] = useState(false)

  const promptRemoveTask = (task: { id: string; title: string }) => {
    setConfirmRemoveTask({ id: task.id, title: task.title, force: false })
  }

  const closeRemoveTaskModal = () => {
    setConfirmRemoveTask(null)
  }

  const removeTask = async (taskId: string, force: boolean) => {
    setTaskRemoveBusy(true)
    const result = await window.takoyaki.workspace.removeTask(taskId, force)
    setTaskRemoveBusy(false)
    if (result.ok) {
      setConfirmRemoveTask(null)
      return
    }
    if (result.blocked) {
      setConfirmRemoveTask((current) => (current ? { ...current, detail: result.detail, force: true } : current))
      return
    }
    setConfirmRemoveTask((current) => (current ? { ...current, detail: result.detail } : current))
  }

  return {
    confirmRemoveTask,
    taskRemoveBusy,
    promptRemoveTask,
    closeRemoveTaskModal,
    removeTask,
  }
}
