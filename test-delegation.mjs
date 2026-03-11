import { getLLMAccounts, saveLLMAccount, getSetting, setSetting } from './dist/db/index.js';
import { execute_delegate_tasks } from './dist/agent/tools/delegate_tasks.js';
import dotenv from 'dotenv';
dotenv.config();

console.log('Injecting mock account...');

// Añadir cuenta dummy
saveLLMAccount({
    id: "dummy123",
    provider: "openai",
    name: "Mock Relevo",
    apiKey: "sk-mock-key-1234",
    isOauth: false,
    model: "gpt-4o-mini"
});

// Mockear principal
setSetting('model_provider', 'openai');
setSetting('model_name', 'gpt-4o-mini');
setSetting('llm_api_key', 'sk-main-key-5678');

console.log('Testing delegate_tasks...');
execute_delegate_tasks({
    tasks: ["Explica qué es un agente IA", "Dime la capital de Francia"]
}).then(res => {
    console.log("FINAL RESULT:\n", res);
}).catch(err => {
    console.error("ERROR:\n", err);
});
