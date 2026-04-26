import { useState } from 'react'
import { colors } from '../design'
import { useStore } from '../store'

interface ConfirmRemoveTaskState {
  id: string
  title: string
  detail?: string
  force: boolean
}

export function useTaskRemovalController() {
  const [confirmRemoveTask, setConfirmRemoveTask] = useState<ConfirmRemoveTaskState | null>(null)
  const [taskRemoveBusy, setTaskRemoveBusy] = useState(false)
  const [removingTaskId, setRemovingTaskId] = useState<string | null>(null)
  const startActivityOperation = useStore((state) => state.startActivityOperation)
  const finishActivityOperation = useStore((state) => state.finishActivityOperation)
  const showToast = useStore((state) => state.showToast)

  // seed the confirmation modal with the task being removed
  const promptRemoveTask = (task: { id: string; title: string }) => {
    setConfirmRemoveTask({ id: task.id, title: task.title, force: false })
  }

  // close the remove task modal without changing workspace state
  const closeRemoveTaskModal = () => {
    setConfirmRemoveTask(null)
  }

  // handle the two stage remove flow where dirty tasks can escalate into a force remove
  const removeTask = async (taskId: string, force: boolean) => {
    setTaskRemoveBusy(true)
    setRemovingTaskId(taskId)
    const taskTitle = confirmRemoveTask?.title || 'task'
    const operationId = startActivityOperation({
      kind: 'git',
      title: force ? 'Force removing task worktree' : 'Removing task worktree',
      detail: taskTitle,
      workspaceId: taskId,
    })
    const result = await window.takoyaki.workspace.removeTask(taskId, force)
    setTaskRemoveBusy(false)
    setRemovingTaskId(null)
    if (result.ok) {
      finishActivityOperation(operationId, 'success', {
        title: 'Task worktree removed',
        detail: result.detail || taskTitle,
      })
      setConfirmRemoveTask(null)
      return
    }
    if (result.blocked) {
      finishActivityOperation(operationId, 'blocked', {
        title: 'Task removal blocked',
        detail: result.detail,
      })
      showToast({ message: 'Task removal is blocked. Open Activity for details.', dot: colors.error }, 4200)
      setConfirmRemoveTask((current) => (current ? { ...current, detail: result.detail, force: true } : current))
      return
    }
    finishActivityOperation(operationId, 'failed', {
      title: 'Task removal failed',
      detail: result.detail,
    })
    showToast({ message: 'Task removal failed. Open Activity for details.', dot: colors.error }, 4200)
    setConfirmRemoveTask((current) => (current ? { ...current, detail: result.detail } : current))
  }

  return {
    confirmRemoveTask,
    taskRemoveBusy,
    removingTaskId,
    promptRemoveTask,
    closeRemoveTaskModal,
    removeTask,
  }
}
