const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectMeeting } = require('../utils/meeting-detector');

// Sábado, 26/09/2026 (horário local).
const at = (h, m = 0) => new Date(2026, 8, 26, h, m).getTime();

describe('detector de agendamento', () => {
  it('EDM Saúde: "fica agendado para quarta às 13h" vira quarta 30/09 13h', () => {
    const r = detectMeeting([
      { fromMe: true, text: 'Perfeito, Elim! Então já deixo agendado: prefere segunda às 11h ou quarta às 13h?', at: at(13, 55) },
      { fromMe: false, text: '13h', at: at(14, 54) },
      { fromMe: true, text: 'Perfeito, Elim! Então fica agendado para quarta às 13h. Vou te mandar um lembrete na terça. Até lá!', at: at(15, 49) },
    ]);
    assert.equal(new Date(r.at).toString(), new Date(2026, 8, 30, 13, 0).toString());
    assert.equal(r.confirmed, true);
    assert.match(r.label, /quarta, 30\/09 às 13h/);
  });

  it('lead escolhe só o horário entre as opções que você mandou', () => {
    const r = detectMeeting([
      { fromMe: true, text: 'Prefere segunda às 11h ou quarta às 13h?', at: at(13) },
      { fromMe: false, text: '13h', at: at(14) },
    ]);
    assert.equal(new Date(r.at).getDay(), 3);
    assert.equal(new Date(r.at).getHours(), 13);
  });

  it('amanhã e dia do mês', () => {
    assert.equal(new Date(detectMeeting([{ fromMe: false, text: 'Pode ser amanhã às 10h30 a reunião', at: at(9) }]).at).toString(), new Date(2026, 8, 27, 10, 30).toString());
    assert.equal(new Date(detectMeeting([{ fromMe: true, text: 'Combinado então, dia 02/10 às 15h!', at: at(9) }]).at).toString(), new Date(2026, 9, 2, 15, 0).toString());
  });

  it('não inventa agendamento em conversa comum', () => {
    assert.equal(detectMeeting([{ fromMe: false, text: 'Abrimos de segunda a sexta das 8h às 18h', at: at(9) }]), null);
    assert.equal(detectMeeting([{ fromMe: false, text: 'Talvez uma por dia...', at: at(9) }]), null);
  });
});

describe('detector de agendamento: não confunde', () => {
  it('horário de funcionamento, link de agenda e texto de apresentação', () => {
    assert.equal(detectMeeting([{ fromMe: false, text: 'Olá, bom dia! Atendemos de segunda a sexta das 8h às 18h. Como podemos ajudar?', at: at(9) }]), null);
    assert.equal(detectMeeting([{ fromMe: false, text: '*Horário marcado nas Sextas e Sábados* MARQUE AQUI: https://agenda.exemplo/agendar às 9h30', at: at(9) }]), null);
    assert.equal(detectMeeting([{ fromMe: true, text: 'Vi que vocês têm ótima avaliação. Hoje, quando alguém chama fora do horário, às 17h por exemplo, quem responde?', at: at(9) }]), null);
  });
});
