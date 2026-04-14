import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../renderer/store'

function resetStore() {
  useStore.setState({
    paneFocusSurfaceId: null,
    activeView: 'terminal',
    reviewWorkspaceId: null,
    selectedReviewFilePath: null,
    reviewFocusMode: false,
    reviewLoading: false,
    reviewPatchLoading: false,
    reviewError: null,
  })
}

describe('store pane focus mode', () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    resetStore()
  })

  it('toggles the same pane on and back off', () => {
    const { togglePaneFocusMode } = useStore.getState()

    togglePaneFocusMode('surface-1')
    expect(useStore.getState().paneFocusSurfaceId).toBe('surface-1')

    togglePaneFocusMode('surface-1')
    expect(useStore.getState().paneFocusSurfaceId).toBeNull()
  })

  it('switches focus mode to a different pane', () => {
    const { togglePaneFocusMode } = useStore.getState()

    togglePaneFocusMode('surface-1')
    togglePaneFocusMode('surface-2')

    expect(useStore.getState().paneFocusSurfaceId).toBe('surface-2')
  })

  it('can set pane focus directly when focus changes underneath the renderer', () => {
    const { setPaneFocusSurfaceId } = useStore.getState()

    setPaneFocusSurfaceId('surface-1')
    expect(useStore.getState().paneFocusSurfaceId).toBe('surface-1')

    setPaneFocusSurfaceId('surface-2')
    expect(useStore.getState().paneFocusSurfaceId).toBe('surface-2')
  })

  it('clears pane focus when review closes', () => {
    useStore.setState({ paneFocusSurfaceId: 'surface-1', activeView: 'review' })

    useStore.getState().closeReview()

    expect(useStore.getState().paneFocusSurfaceId).toBeNull()
    expect(useStore.getState().activeView).toBe('terminal')
  })
})
