#!/usr/bin/env node
// Caminho antigo do hook de permissão. Até a 0.2.0, um instalador gravava este arquivo no settings.json das contas;
// o script passou para mod/expediente-permissoes/hooks/permission-hook.mjs (o plugin expediente-permissoes). Este
// atalho mantém essas instalações funcionando depois de atualizar o repositório. Node puro, sem dependências.
import { main } from '../mod/expediente-permissoes/hooks/permission-hook.mjs';

main().catch(() => process.exit(0));
