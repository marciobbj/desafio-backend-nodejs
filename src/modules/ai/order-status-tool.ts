const orderStatuses = new Map<string, string>([
  ["PED-1001", "Instalacao agendada para o proximo dia util, periodo da manha."],
  ["PED-2002", "Pedido em analise de cobertura. Retorno previsto em ate 24 horas."],
  ["PED-3003", "Chamado tecnico aberto. Visita presencial dentro do SLA residencial de ate 48h uteis."],
]);

export function consultarStatusPedido(protocol: string) {
  const normalized = protocol.trim().toUpperCase();
  return (
    orderStatuses.get(normalized) ??
    `Nao encontramos status para o protocolo ${normalized}. Confira o numero informado ou aguarde atendimento humano.`
  );
}
