import { writeFileSync } from 'node:fs';

export default class ReporterDeTempos {
  registros = [];

  onTestCaseResult(testCase) {
    if (testCase.result().state !== 'passed') return;
    this.registros.push({
      arquivo: testCase.module.moduleId,
      nome: testCase.fullName,
      duracao: testCase.diagnostic()?.duration ?? 0,
      limite: testCase.task.timeout,
    });
  }

  onTestRunEnd() {
    if (process.env.EXPEDIENTE_TEMPOS_SAIDA) {
      writeFileSync(process.env.EXPEDIENTE_TEMPOS_SAIDA, JSON.stringify(this.registros));
    }
  }
}
