#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import chokidar from 'chokidar';
import { Command } from 'commander';
import {
  loadConfig,
  ingestProject,
  queryContext,
  ContextStore,
  createDefaultConfig,
  saveConfig,
  type ProjectConfig,
  type SourceDescriptor
} from '@seas-context/core-indexer';
import { cortexxCapability, enrichCortexxQuery, patchCortexxConfig } from '@seas-context/provider-cortexx';

function resolveProviderConfig(configPath?: string) {
  const resolvedPath = resolve(configPath ?? 'contextmcp.toml');
  const config = loadConfig(resolvedPath);
  return {
    configPath: resolvedPath,
    config: config.provider === 'cortexx' ? patchCortexxConfig(config) : config
  };
}

function getCapability(provider: string) {
  return provider === 'cortexx'
    ? cortexxCapability
    : { name: 'generic', can_query: true, can_write: true, entities: ['project', 'source', 'chunk', 'evidence'] };
}

function withProviderQuery(config: ProjectConfig, text: string) {
  return config.provider === 'cortexx' ? enrichCortexxQuery(text) : text;
}

function readConfig(configPath?: string) {
  return resolveProviderConfig(configPath);
}

const program = new Command();
program.name('context').description('SEAS Context MCP CLI');

program.command('init')
  .option('-c, --config <path>', 'config path', 'contextmcp.toml')
  .option('-r, --project-root <path>', 'project root', process.cwd())
  .option('-p, --provider <provider>', 'provider name', 'generic')
  .action((opts) => {
    const configPath = resolve(opts.config);
    const config = createDefaultConfig(opts.projectRoot, opts.provider);
    if (opts.provider === 'cortexx') {
      config.project_id = 'cortexx';
      config.project_name = 'Córtexx';
      config.include.globs = [
        'AGENTS.md',
        '.context/**/*.{md,yml,yaml,json}',
        '.kiro/**/*.{md,yml,yaml,json}',
        'server/**/*.{js,md}',
        'src/**/*.{ts,tsx,md}',
        'services/**/*.{js,ts,md}',
        'package.json'
      ];
    }
    saveConfig(configPath, config);
    console.log(JSON.stringify({ created: configPath, provider: config.provider, project_root: config.project_root }, null, 2));
  });

program.command('ingest')
  .option('-c, --config <path>')
  .action(async (opts) => {
    const { config } = readConfig(opts.config);
    console.log(JSON.stringify(await ingestProject(config), null, 2));
  });

program.command('watch')
  .option('-c, --config <path>')
  .action(async (opts) => {
    const { config } = readConfig(opts.config);
    await ingestProject(config);
    console.log(JSON.stringify({ watching: config.project_root, project_id: config.project_id }, null, 2));
    const watcher = chokidar.watch(config.include.globs, {
      cwd: config.project_root,
      ignored: config.exclude.globs,
      ignoreInitial: true,
      persistent: true
    });
    const trigger = async (event: string, path: string) => {
      const health = await ingestProject(config);
      console.log(JSON.stringify({ event, path, health }, null, 2));
    };
    watcher.on('add', (path) => void trigger('add', path));
    watcher.on('change', (path) => void trigger('change', path));
    watcher.on('unlink', (path) => void trigger('unlink', path));
  });

program.command('query')
  .argument('<text>')
  .option('-c, --config <path>')
  .action(async (text, opts) => {
    const { config } = readConfig(opts.config);
    console.log(JSON.stringify(await queryContext(config, withProviderQuery(config, text)), null, 2));
  });

program.command('evidence')
  .argument('<text>')
  .option('-c, --config <path>')
  .action(async (text, opts) => {
    const { config } = readConfig(opts.config);
    const result = await queryContext(config, withProviderQuery(config, text));
    console.log(JSON.stringify(result.evidence, null, 2));
  });

program.command('map')
  .option('-c, --config <path>')
  .action((opts) => {
    const { config } = readConfig(opts.config);
    const store = new ContextStore(config.project_root);
    console.log(JSON.stringify(store.projectMap(config.project_id), null, 2));
  });

program.command('health')
  .option('-c, --config <path>')
  .action((opts) => {
    const { config } = readConfig(opts.config);
    const store = new ContextStore(config.project_root);
    console.log(JSON.stringify(store.health(config.project_id), null, 2));
  });

program.command('source-add')
  .requiredOption('-t, --type <type>')
  .requiredOption('-n, --name <name>')
  .option('-p, --path <path>')
  .option('-u, --url <url>')
  .option('-o, --owner <owner>')
  .option('-r, --repo <repo>')
  .option('-c, --config <path>', 'config path', 'contextmcp.toml')
  .action((opts) => {
    const { configPath, config } = readConfig(opts.config);
    const nextSource: SourceDescriptor = {
      type: opts.type,
      name: opts.name,
      path: opts.path,
      url: opts.url,
      owner: opts.owner,
      repo: opts.repo,
      read_enabled: true,
      write_enabled: false
    };
    config.sources = [...config.sources, nextSource];
    saveConfig(configPath, config);
    console.log(JSON.stringify({ updated: configPath, source: nextSource }, null, 2));
  });

program.command('source-sync')
  .option('-c, --config <path>')
  .action(async (opts) => {
    const { config } = readConfig(opts.config);
    console.log(JSON.stringify({ synced_sources: config.sources.map((source) => source.name), health: await ingestProject(config) }, null, 2));
  });

program.command('provider-status')
  .option('-c, --config <path>')
  .action((opts) => {
    const { config } = readConfig(opts.config);
    console.log(JSON.stringify({ provider: config.provider, capability: getCapability(config.provider) }, null, 2));
  });

program.command('doctor')
  .option('-c, --config <path>')
  .action((opts) => {
    const { configPath, config } = readConfig(opts.config);
    const store = new ContextStore(config.project_root);
    const health = store.health(config.project_id);
    console.log(JSON.stringify({
      config_path: configPath,
      project_id: config.project_id,
      project_root: config.project_root,
      provider: config.provider,
      state_dir: resolve(config.project_root, '.seas-context'),
      sources: config.sources,
      health,
      has_openai_key: Boolean(process.env.OPENAI_API_KEY),
      has_github_token: Boolean(process.env.GITHUB_TOKEN),
      provider_entities: getCapability(config.provider).entities
    }, null, 2));
  });

program.parseAsync(process.argv);
