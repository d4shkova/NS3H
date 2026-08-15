/** Shapes returned by the log browser (§6.3 Logs). */

export interface LogFolderInfo {
  /** Directory name under the log root; also the id used to list its sessions. */
  name: string;
  displayName: string;
  hostId: string | null;
  sessions: number;
  totalBytes: number;
  lastSession: string | null;
}

export interface LogFileInfo {
  name: string;
  path: string;
  bytes: number;
  modified: string;
}

export interface LogDocument {
  path: string;
  bytes: number;
  lineCount: number;
}

export interface LogMatch {
  line: number;
  /** Column of the first hit on that line, for scrolling and highlighting. */
  column: number;
}
