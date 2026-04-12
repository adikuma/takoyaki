import { useEffect, useRef, useState } from 'react'
import {
  getTaskBranchValidationError,
  getTaskTitleValidationError,
  TASK_BRANCH_REQUIRED_ERROR,
  TASK_TITLE_REQUIRED_ERROR,
} from './sidebar-utils'

export function useTaskCreationController() {
  const [taskModalProjectId, setTaskModalProjectId] = useState<string | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskBranchName, setTaskBranchName] = useState('')
  const [taskBranches, setTaskBranches] = useState<string[]>([])
  const [taskBranchesLoading, setTaskBranchesLoading] = useState(false)
  const [taskBaseBranch, setTaskBaseBranch] = useState('')
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null)
  const [taskCreating, setTaskCreating] = useState(false)
  const taskTitleRef = useRef<HTMLInputElement>(null)
  const taskBranchNameRef = useRef<HTMLInputElement>(null)

  // reset modal state and load base branches every time a project opens the task dialog
  useEffect(() => {
    if (!taskModalProjectId) return
    setTaskTitle('')
    setTaskBranchName('')
    setTaskBaseBranch('')
    setTaskCreateError(null)
    setTaskCreating(false)
    setTaskBranches([])
    setTaskBranchesLoading(true)
    void window.takoyaki.workspace
      .listBranches(taskModalProjectId)
      .then((branches) => {
        setTaskBranches(branches)
        setTaskBaseBranch(branches[0] || '')
      })
      .finally(() => setTaskBranchesLoading(false))
    setTimeout(() => taskTitleRef.current?.focus(), 40)
  }, [taskModalProjectId])

  // open the task modal for one project at a time
  const openTaskModal = (projectId: string) => {
    setTaskModalProjectId(projectId)
  }

  // clear the modal by removing the active project id
  const closeTaskModal = () => {
    setTaskModalProjectId(null)
  }

  // clear only the required field error once the title becomes valid again
  const setTaskTitleValue = (nextTitle: string) => {
    setTaskTitle(nextTitle)
    if (taskCreateError === TASK_TITLE_REQUIRED_ERROR && nextTitle.trim()) {
      setTaskCreateError(null)
    }
  }

  // clear only the required field error once the branch name becomes valid again
  const setTaskBranchNameValue = (nextBranchName: string) => {
    setTaskBranchName(nextBranchName)
    if (taskCreateError === TASK_BRANCH_REQUIRED_ERROR && nextBranchName.trim()) {
      setTaskCreateError(null)
    }
  }

  // validate locally first and then hand the request to the main process create task flow
  const createTask = async () => {
    if (!taskModalProjectId) return
    const taskTitleValidationError = getTaskTitleValidationError(taskTitle)
    if (taskTitleValidationError) {
      setTaskCreateError(taskTitleValidationError)
      setTimeout(() => taskTitleRef.current?.focus(), 0)
      return
    }
    const taskBranchValidationError = getTaskBranchValidationError(taskBranchName)
    if (taskBranchValidationError) {
      setTaskCreateError(taskBranchValidationError)
      setTimeout(() => taskBranchNameRef.current?.focus(), 0)
      return
    }

    setTaskCreating(true)
    setTaskCreateError(null)
    const result = await window.takoyaki.workspace.createTask(taskModalProjectId, {
      taskTitle: taskTitle.trim(),
      branchName: taskBranchName.trim(),
      baseBranch: taskBaseBranch || undefined,
    })
    setTaskCreating(false)
    if (!result.ok) {
      setTaskCreateError(result.detail || 'Unable to create task')
      return
    }
    setTaskModalProjectId(null)
  }

  return {
    taskModalProjectId,
    taskTitle,
    taskBranchName,
    taskBranches,
    taskBranchesLoading,
    taskBaseBranch,
    taskCreateError,
    taskCreating,
    taskTitleRef,
    taskBranchNameRef,
    openTaskModal,
    closeTaskModal,
    setTaskTitleValue,
    setTaskBranchNameValue,
    setTaskBaseBranch,
    createTask,
  }
}
