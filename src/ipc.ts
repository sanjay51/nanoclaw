import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, IPC_POLL_INTERVAL, TIMEZONE } from './config.js';
import { AvailableGroup } from './container-runner.js';
import {
  createTask,
  deleteSession,
  deleteTask,
  getPersonalityById,
  getRegisteredGroup,
  getTaskById,
  setRegisteredGroup,
  updateTask,
} from './db.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { nudgeScheduler } from './task-scheduler.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  onTasksChanged: () => void;
}

export interface TaskIpcResult {
  ok: boolean;
  message?: string;
  error?: string;
  taskId?: string;
}

const WEB_JID_PREFIX = 'web:';
const ACK_TTL_MS = 60_000;

/**
 * Resolve a target JID to a registered group. Mirrors resolveHostGroup:
 * ephemeral web chat JIDs fall back to any registered web:* group so
 * scheduling from a transient web session lands on the host web group.
 */
function resolveTargetGroup(
  targetJid: string,
  registeredGroups: Record<string, RegisteredGroup>,
): RegisteredGroup | undefined {
  const direct = registeredGroups[targetJid];
  if (direct) return direct;
  if (!targetJid.startsWith(WEB_JID_PREFIX)) return undefined;
  const preferred = registeredGroups[WEB_JID_PREFIX + 'localhost'];
  if (preferred) return preferred;
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (jid.startsWith(WEB_JID_PREFIX)) return group;
  }
  return undefined;
}

function writeAckFile(
  sourceGroup: string,
  filename: string,
  result: TaskIpcResult,
): void {
  try {
    const ackDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'tasks_ack');
    fs.mkdirSync(ackDir, { recursive: true });
    const ackPath = path.join(ackDir, filename);
    const tempPath = `${ackPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(result));
    fs.renameSync(tempPath, ackPath);
  } catch (err) {
    logger.error({ err, sourceGroup, filename }, 'Failed to write IPC ack');
  }
}

function cleanupStaleAcks(sourceGroup: string): void {
  try {
    const ackDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'tasks_ack');
    if (!fs.existsSync(ackDir)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(ackDir)) {
      const p = path.join(ackDir, f);
      try {
        const stat = fs.statSync(p);
        if (now - stat.mtimeMs > ACK_TTL_MS) fs.unlinkSync(p);
      } catch {
        // ignore: file may have been removed by the container already
      }
    }
  } catch {
    // ignore
  }
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    // Build folder→isMain lookup from registered groups
    const folderIsMain = new Map<string, boolean>();
    for (const group of Object.values(registeredGroups)) {
      if (group.isMain) folderIsMain.set(group.folder, true);
    }

    for (const sourceGroup of groupFolders) {
      const isMain = folderIsMain.get(sourceGroup) === true;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendMessage(data.chatJid, data.text);
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              const result = await processTaskIpc(
                data,
                sourceGroup,
                isMain,
                deps,
              );
              writeAckFile(sourceGroup, file, result);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              writeAckFile(sourceGroup, file, {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }

      cleanupStaleAcks(sourceGroup);
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    script?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For switch_personality
    personalityId?: string;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<TaskIpcResult> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task': {
      if (
        !data.prompt ||
        !data.schedule_type ||
        !data.schedule_value ||
        !data.targetJid
      ) {
        return {
          ok: false,
          error:
            'Missing required fields (prompt, schedule_type, schedule_value, targetJid)',
        };
      }

      const targetJid = data.targetJid as string;
      const targetGroupEntry = resolveTargetGroup(targetJid, registeredGroups);

      if (!targetGroupEntry) {
        logger.warn(
          { targetJid },
          'Cannot schedule task: target group not registered',
        );
        return {
          ok: false,
          error: `Target group not registered for JID ${targetJid}`,
        };
      }

      const targetFolder = targetGroupEntry.folder;

      if (!isMain && targetFolder !== sourceGroup) {
        logger.warn(
          { sourceGroup, targetFolder },
          'Unauthorized schedule_task attempt blocked',
        );
        return {
          ok: false,
          error: `Not authorized to schedule for group ${targetFolder}`,
        };
      }

      const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

      let nextRun: string | null = null;
      if (scheduleType === 'cron') {
        try {
          const interval = CronExpressionParser.parse(data.schedule_value, {
            tz: TIMEZONE,
          });
          nextRun = interval.next().toISOString();
        } catch {
          logger.warn(
            { scheduleValue: data.schedule_value },
            'Invalid cron expression',
          );
          return {
            ok: false,
            error: `Invalid cron expression: ${data.schedule_value}`,
          };
        }
      } else if (scheduleType === 'interval') {
        const ms = parseInt(data.schedule_value, 10);
        if (isNaN(ms) || ms <= 0) {
          logger.warn(
            { scheduleValue: data.schedule_value },
            'Invalid interval',
          );
          return {
            ok: false,
            error: `Invalid interval: ${data.schedule_value}`,
          };
        }
        nextRun = new Date(Date.now() + ms).toISOString();
      } else if (scheduleType === 'once') {
        const date = new Date(data.schedule_value);
        if (isNaN(date.getTime())) {
          logger.warn(
            { scheduleValue: data.schedule_value },
            'Invalid timestamp',
          );
          return {
            ok: false,
            error: `Invalid timestamp: ${data.schedule_value}`,
          };
        }
        nextRun = date.toISOString();
      }

      const taskId =
        data.taskId ||
        `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contextMode =
        data.context_mode === 'group' || data.context_mode === 'isolated'
          ? data.context_mode
          : 'isolated';
      createTask({
        id: taskId,
        group_folder: targetFolder,
        chat_jid: targetJid,
        prompt: data.prompt,
        script: data.script || null,
        schedule_type: scheduleType,
        schedule_value: data.schedule_value,
        context_mode: contextMode,
        next_run: nextRun,
        status: 'active',
        created_at: new Date().toISOString(),
      });
      logger.info(
        { taskId, sourceGroup, targetFolder, contextMode },
        'Task created via IPC',
      );
      deps.onTasksChanged();
      nudgeScheduler();
      return {
        ok: true,
        taskId,
        message: `Task ${taskId} scheduled: ${scheduleType} - ${data.schedule_value}`,
      };
    }

    case 'pause_task': {
      if (!data.taskId) return { ok: false, error: 'taskId required' };
      const task = getTaskById(data.taskId);
      if (!task || (!isMain && task.group_folder !== sourceGroup)) {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          task ? 'Unauthorized task pause attempt' : 'Task not found for pause',
        );
        return {
          ok: false,
          error: task
            ? `Not authorized to pause task ${data.taskId}`
            : `Task ${data.taskId} not found`,
        };
      }
      updateTask(data.taskId, { status: 'paused' });
      logger.info({ taskId: data.taskId, sourceGroup }, 'Task paused via IPC');
      deps.onTasksChanged();
      return { ok: true, taskId: data.taskId, message: 'Task paused' };
    }

    case 'resume_task': {
      if (!data.taskId) return { ok: false, error: 'taskId required' };
      const task = getTaskById(data.taskId);
      if (!task || (!isMain && task.group_folder !== sourceGroup)) {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          task
            ? 'Unauthorized task resume attempt'
            : 'Task not found for resume',
        );
        return {
          ok: false,
          error: task
            ? `Not authorized to resume task ${data.taskId}`
            : `Task ${data.taskId} not found`,
        };
      }
      updateTask(data.taskId, { status: 'active' });
      logger.info({ taskId: data.taskId, sourceGroup }, 'Task resumed via IPC');
      deps.onTasksChanged();
      return { ok: true, taskId: data.taskId, message: 'Task resumed' };
    }

    case 'cancel_task': {
      if (!data.taskId) return { ok: false, error: 'taskId required' };
      const task = getTaskById(data.taskId);
      if (!task || (!isMain && task.group_folder !== sourceGroup)) {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          task
            ? 'Unauthorized task cancel attempt'
            : 'Task not found for cancel',
        );
        return {
          ok: false,
          error: task
            ? `Not authorized to cancel task ${data.taskId}`
            : `Task ${data.taskId} not found`,
        };
      }
      deleteTask(data.taskId);
      logger.info(
        { taskId: data.taskId, sourceGroup },
        'Task cancelled via IPC',
      );
      deps.onTasksChanged();
      return { ok: true, taskId: data.taskId, message: 'Task cancelled' };
    }

    case 'update_task': {
      if (!data.taskId) return { ok: false, error: 'taskId required' };
      const task = getTaskById(data.taskId);
      if (!task) {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          'Task not found for update',
        );
        return { ok: false, error: `Task ${data.taskId} not found` };
      }
      if (!isMain && task.group_folder !== sourceGroup) {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          'Unauthorized task update attempt',
        );
        return {
          ok: false,
          error: `Not authorized to update task ${data.taskId}`,
        };
      }

      const updates: Parameters<typeof updateTask>[1] = {};
      if (data.prompt !== undefined) updates.prompt = data.prompt;
      if (data.script !== undefined) updates.script = data.script || null;
      if (data.schedule_type !== undefined)
        updates.schedule_type = data.schedule_type as
          | 'cron'
          | 'interval'
          | 'once';
      if (data.schedule_value !== undefined)
        updates.schedule_value = data.schedule_value;

      // Recompute next_run if schedule changed
      if (data.schedule_type || data.schedule_value) {
        const updatedTask = {
          ...task,
          ...updates,
        };
        if (updatedTask.schedule_type === 'cron') {
          try {
            const interval = CronExpressionParser.parse(
              updatedTask.schedule_value,
              { tz: TIMEZONE },
            );
            updates.next_run = interval.next().toISOString();
          } catch {
            logger.warn(
              { taskId: data.taskId, value: updatedTask.schedule_value },
              'Invalid cron in task update',
            );
            return {
              ok: false,
              error: `Invalid cron expression: ${updatedTask.schedule_value}`,
            };
          }
        } else if (updatedTask.schedule_type === 'interval') {
          const ms = parseInt(updatedTask.schedule_value, 10);
          if (!isNaN(ms) && ms > 0) {
            updates.next_run = new Date(Date.now() + ms).toISOString();
          }
        }
      }

      updateTask(data.taskId, updates);
      logger.info(
        { taskId: data.taskId, sourceGroup, updates },
        'Task updated via IPC',
      );
      deps.onTasksChanged();
      return { ok: true, taskId: data.taskId, message: 'Task updated' };
    }

    case 'refresh_groups': {
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
        return {
          ok: false,
          error: 'Only main group can refresh group metadata',
        };
      }
      logger.info({ sourceGroup }, 'Group metadata refresh requested via IPC');
      await deps.syncGroups(true);
      const availableGroups = deps.getAvailableGroups();
      deps.writeGroupsSnapshot(
        sourceGroup,
        true,
        availableGroups,
        new Set(Object.keys(registeredGroups)),
      );
      return { ok: true, message: 'Groups refreshed' };
    }

    case 'register_group': {
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        return {
          ok: false,
          error: 'Only main group can register new groups',
        };
      }
      if (!(data.jid && data.name && data.folder && data.trigger)) {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
        return {
          ok: false,
          error: 'register_group requires jid, name, folder, trigger',
        };
      }
      if (!isValidGroupFolder(data.folder)) {
        logger.warn(
          { sourceGroup, folder: data.folder },
          'Invalid register_group request - unsafe folder name',
        );
        return { ok: false, error: `Invalid folder name: ${data.folder}` };
      }
      const existingGroup = registeredGroups[data.jid];
      deps.registerGroup(data.jid, {
        name: data.name,
        folder: data.folder,
        trigger: data.trigger,
        added_at: new Date().toISOString(),
        containerConfig: data.containerConfig,
        requiresTrigger: data.requiresTrigger,
        isMain: existingGroup?.isMain,
      });
      return { ok: true, message: `Group "${data.name}" registered` };
    }

    case 'switch_personality': {
      if (!(data.personalityId && data.chatJid)) {
        return {
          ok: false,
          error: 'switch_personality requires personalityId and chatJid',
        };
      }
      const personality = getPersonalityById(data.personalityId);
      if (!personality) {
        logger.warn(
          { personalityId: data.personalityId, sourceGroup },
          'Personality not found for switch',
        );
        return {
          ok: false,
          error: `Personality ${data.personalityId} not found`,
        };
      }
      const targetGroup = registeredGroups[data.chatJid];
      if (!targetGroup) {
        logger.warn(
          { chatJid: data.chatJid, sourceGroup },
          'Group not found for personality switch',
        );
        return {
          ok: false,
          error: `Group not found for chat ${data.chatJid}`,
        };
      }
      if (!isMain && targetGroup.folder !== sourceGroup) {
        logger.warn(
          { chatJid: data.chatJid, sourceGroup },
          'Unauthorized personality switch attempt',
        );
        return {
          ok: false,
          error: `Not authorized to switch personality for ${data.chatJid}`,
        };
      }
      const updated = { ...targetGroup, personalityId: data.personalityId };
      setRegisteredGroup(data.chatJid, updated);
      deleteSession(targetGroup.folder);
      const groups = deps.registeredGroups();
      groups[data.chatJid] = updated;
      logger.info(
        {
          chatJid: data.chatJid,
          personality: personality.name,
          personalityId: data.personalityId,
          sourceGroup,
        },
        'Personality switched via IPC',
      );
      return {
        ok: true,
        message: `Personality switched to ${personality.name}`,
      };
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
      return { ok: false, error: `Unknown IPC task type: ${data.type}` };
  }
}
