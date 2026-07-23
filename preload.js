const { contextBridge, ipcRenderer } = require('electron');

// Minimal, read/write-only bridge to the renderer — no direct filesystem or
// Node access, per contextIsolation + sandbox best practice.
contextBridge.exposeInMainWorld('scheduleAPI', {
  load: () => ipcRenderer.invoke('schedule:load'),
  save: (data) => ipcRenderer.invoke('schedule:save', data)
});

// Fully separate bridge for Team mode's data — own IPC channels, own file on
// disk (see main.js), zero overlap with the single-employee scheduleAPI above.
contextBridge.exposeInMainWorld('teamScheduleAPI', {
  load: () => ipcRenderer.invoke('teamSchedule:load'),
  save: (data) => ipcRenderer.invoke('teamSchedule:save', data)
});
