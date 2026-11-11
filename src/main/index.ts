import { app } from 'electron'
import { translocated } from './dataDir'

// A translocated copy has nowhere to keep its data: it offers to move itself instead of starting.
if (app.isPackaged && translocated(process.platform, process.execPath)) void import('./translocation').then((t) => t.offerMove())
else void import('./main')
