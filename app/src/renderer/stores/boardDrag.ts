import { create } from 'zustand';
import type { BoardIssue } from '../../shared/workspace';

interface BoardDragState {
  draggingIssue: BoardIssue | null;
  setDraggingIssue(issue: BoardIssue | null): void;
}

export const useBoardDragStore = create<BoardDragState>((set) => ({
  draggingIssue: null,
  setDraggingIssue(issue) { set({ draggingIssue: issue }); },
}));
