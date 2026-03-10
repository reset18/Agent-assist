import { get_current_time_def, execute_get_current_time } from './tools/get_current_time.js';
import { read_file_local_def, execute_read_file_local, write_file_local_def, execute_write_file_local, list_dir_local_def, execute_list_dir_local, run_shell_local_def, execute_run_shell_local } from './tools/local_system.js';
import { run_ssh_command_def, execute_run_ssh_command } from './tools/run_ssh_command.js';
import { speak_message_def, execute_speak_message } from './tools/speak_message.js';
import { package_skill_def, execute_package_skill } from './tools/package_skill.js';
import { toggle_skill_def, execute_toggle_skill } from './tools/toggle_skill.js';
import { list_skills_def, execute_list_skills } from './tools/list_skills.js';
import { update_setting_def, execute_update_setting } from './tools/update_setting.js';
import { update_memory_details as update_memory_def, execute_update_memory } from './tools/update_memory.js';
import { isToolEnabled, getSetting } from '../db/index.js';

const AVAILABLE_TOOLS = {
    get_current_time: {
        def: get_current_time_def,
        execute: execute_get_current_time
    },
    read_file_local: {
        def: read_file_local_def,
        execute: execute_read_file_local
    },
    write_file_local: {
        def: write_file_local_def,
        execute: execute_write_file_local
    },
    list_dir_local: {
        def: list_dir_local_def,
        execute: execute_list_dir_local
    },
    run_shell_local: {
        def: run_shell_local_def,
        execute: execute_run_shell_local
    },
    run_ssh_command: {
        def: run_ssh_command_def,
        execute: execute_run_ssh_command
    },
    speak_message: {
        def: speak_message_def,
        execute: execute_speak_message
    },
    package_skill: {
        def: package_skill_def,
        execute: execute_package_skill
    },
    toggle_skill: {
        def: toggle_skill_def,
        execute: execute_toggle_skill
    },
    list_skills: {
        def: list_skills_def,
        execute: execute_list_skills
    },
    update_setting: {
        def: update_setting_def,
        execute: execute_update_setting
    },
    update_memory: {
        def: update_memory_def,
        execute: execute_update_memory
    }
};

export function getActiveTools() {
    const tools = [];
    for (const [key, tool] of Object.entries(AVAILABLE_TOOLS)) {
        if (key === 'speak_message') {
            const enabled = getSetting('voice_enabled') === '1' || getSetting('elevenlabs_enabled') === '1';
            if (enabled) {
                tools.push(tool.def);
            }
            continue;
        }

        if (key === 'update_setting') {
            tools.push(tool.def);
            continue;
        }

        if (key === 'update_memory') {
            tools.push(tool.def);
            continue;
        }

        if (isToolEnabled(key)) {
            tools.push(tool.def);
        }
    }
    return tools;
}

export async function executeToolCall(toolCall: any) {
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');
    const tool = (AVAILABLE_TOOLS as any)[name];
    if (tool) {
        try {
            console.log(`[Tool] Ejecutando: ${name} con args:`, args);
            const result = await tool.execute(args);
            return JSON.stringify(result);
        } catch (e: any) {
            console.error(`[Tool] Error ejecutando ${name}:`, e);
            return `Error executing tool: ${e.message}`;
        }
    }
    return `Tool ${name} not found.`;
}
