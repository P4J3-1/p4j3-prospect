import React, { useState, useRef, useEffect } from 'react';

const NICHOS = [
  'Dentistas', 'Clínica odontológica', 'Ortodontista', 'Odontologia', 'Aparelho ortodôntico',
  'Academias', 'Personal trainer', 'Crossfit', 'Restaurantes', 'Pizzarias', 'Hamburguerias',
  'Comida japonesa', 'Escritório de advocacia', 'Advogados', 'Advocacia trabalhista',
  'Advocacia empresarial', 'Contabilidade', 'Escritório de contabilidade', 'Imobiliárias',
  'Corretores de imóveis', 'Clínicas de estética', 'Salão de beleza', 'Barbearias',
  'Pet shops', 'Veterinários', 'Autoescolas', 'Oficinas mecânicas', 'Escolas',
  'Cursos profissionalizantes', 'Psicólogos', 'Fisioterapeutas', 'Arquitetos', 'Designers',
  'Agências de marketing', 'Padarias', 'Farmácias', 'Hotéis', 'Lava-jatos', 'Clínicas médicas', 'Laboratórios'
];

const CIDADES = [
  ['São Paulo', 'SP'], ['Guarulhos', 'SP'], ['Campinas', 'SP'], ['São Bernardo do Campo', 'SP'],
  ['Santo André', 'SP'], ['São José dos Campos', 'SP'], ['Osasco', 'SP'], ['Ribeirão Preto', 'SP'],
  ['Sorocaba', 'SP'], ['Santos', 'SP'], ['Mauá', 'SP'], ['São José do Rio Preto', 'SP'],
  ['Diadema', 'SP'], ['Jundiaí', 'SP'], ['Mogi das Cruzes', 'SP'], ['Piracicaba', 'SP'],
  ['Rio de Janeiro', 'RJ'], ['São Gonçalo', 'RJ'], ['Duque de Caxias', 'RJ'], ['Nova Iguaçu', 'RJ'],
  ['Niterói', 'RJ'], ['Belford Roxo', 'RJ'], ['São João de Meriti', 'RJ'], ['Petrópolis', 'RJ'],
  ['Belo Horizonte', 'MG'], ['Contagem', 'MG'], ['Uberlândia', 'MG'], ['Juiz de Fora', 'MG'],
  ['Curitiba', 'PR'], ['Londrina', 'PR'], ['Maringá', 'PR'],
  ['Porto Alegre', 'RS'], ['Caxias do Sul', 'RS'], ['Canoas', 'RS'],
  ['Salvador', 'BA'], ['Feira de Santana', 'BA'],
  ['Florianópolis', 'SC'], ['Joinville', 'SC'], ['Blumenau', 'SC'],
  ['Goiânia', 'GO'], ['Aparecida de Goiânia', 'GO'],
  ['Recife', 'PE'], ['Jaboatão dos Guararapes', 'PE'], ['Olinda', 'PE'],
  ['Fortaleza', 'CE'], ['Belém', 'PA'], ['São Luís', 'MA'], ['Maceió', 'AL'],
  ['Natal', 'RN'], ['João Pessoa', 'PB'], ['Aracaju', 'SE'], ['Teresina', 'PI'],
  ['Vitória', 'ES'], ['Vila Velha', 'ES'], ['Campo Grande', 'MS'], ['Cuiabá', 'MT'],
  ['Palmas', 'TO'], ['Porto Velho', 'RO'], ['Rio Branco', 'AC'], ['Manaus', 'AM'],
  ['Boa Vista', 'RR'], ['Macapá', 'AP'], ['Brasília', 'DF']
].map(([n, uf]) => ({ n, uf, estado: false }));

const ESTADOS = [
  ['Acre', 'AC'], ['Alagoas', 'AL'], ['Amapá', 'AP'], ['Amazonas', 'AM'], ['Bahia', 'BA'],
  ['Ceará', 'CE'], ['Espírito Santo', 'ES'], ['Goiás', 'GO'], ['Maranhão', 'MA'],
  ['Mato Grosso', 'MT'], ['Mato Grosso do Sul', 'MS'], ['Minas Gerais', 'MG'], ['Pará', 'PA'],
  ['Paraíba', 'PB'], ['Paraná', 'PR'], ['Pernambuco', 'PE'], ['Piauí', 'PI'],
  ['Rio de Janeiro', 'RJ'], ['Rio Grande do Norte', 'RN'], ['Rio Grande do Sul', 'RS'],
  ['Rondônia', 'RO'], ['Roraima', 'RR'], ['Santa Catarina', 'SC'], ['São Paulo', 'SP'],
  ['Sergipe', 'SE'], ['Tocantins', 'TO'], ['Distrito Federal', 'DF']
].map(([n, uf]) => ({ n, uf, estado: true }));

const POP_CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília', 'Curitiba', 'Porto Alegre', 'Salvador', 'Recife', 'Fortaleza', 'Goiânia'];

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export default function NewExtractionModal({
  isOpen,
  onClose,
  onStartExtraction,
  onAddToQueue,
  isProcessing
}) {
  const [step, setStep] = useState(1);
  const [nicho, setNicho] = useState('');
  const [nichoError, setNichoError] = useState(false);
  const [nichoSuggestions, setNichoSuggestions] = useState([]);
  const [showNichoList, setShowNichoList] = useState(false);

  const [cidadeObj, setCidadeObj] = useState(null);
  const [cidadeInput, setCidadeInput] = useState('');
  const [cidadeError, setCidadeError] = useState(false);
  const [locSuggestions, setLocSuggestions] = useState([]);
  const [showLocList, setShowLocList] = useState(false);

  const [bairroInput, setBairroInput] = useState('');
  const [bairros, setBairros] = useState([]);

  const carViewRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setNicho('');
      setNichoError(false);
      setCidadeObj(null);
      setCidadeInput('');
      setCidadeError(false);
      setBairroInput('');
      setBairros([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const wzTitles = {
    1: 'Qual nicho você quer pesquisar?',
    2: 'Em qual cidade?',
    3: 'Quais bairros?'
  };

  const handleNichoChange = (val) => {
    setNicho(val);
    setNichoError(false);
    const nq = norm(val).trim();
    if (!nq) {
      setNichoSuggestions([]);
      setShowNichoList(false);
      return;
    }
    const pre = [];
    const mid = [];
    NICHOS.forEach((t) => {
      const nt = norm(t);
      if (nt.indexOf(nq) === 0) pre.push(t);
      else if (nt.indexOf(nq) >= 0) mid.push(t);
    });
    const results = pre.concat(mid).slice(0, 7);
    setNichoSuggestions(results);
    setShowNichoList(results.length > 0);
  };

  const pickNicho = (val) => {
    setNicho(val);
    setNichoError(false);
    setShowNichoList(false);
    setStep(2);
  };

  const handleLocChange = (val) => {
    setCidadeInput(val);
    setCidadeObj(null);
    setCidadeError(false);
    const nq = norm(val).trim();
    if (!nq) {
      setLocSuggestions([]);
      setShowLocList(false);
      return;
    }
    const all = CIDADES.concat(ESTADOS);
    const scored = [];
    all.forEach((c) => {
      const nn = norm(c.n);
      let s = -1;
      if (nn === nq) s = 0;
      else if (nn.indexOf(nq) === 0) s = 1;
      else if (nn.indexOf(nq) >= 0) s = 2;
      if (s < 0) return;
      if (c.estado) s += 0.5;
      scored.push({ c, s });
    });
    scored.sort((a, b) => a.s - b.s || a.c.n.localeCompare(b.c.n, 'pt-BR'));
    const results = scored.slice(0, 7).map((r) => r.c);
    setLocSuggestions(results);
    setShowLocList(results.length > 0);
  };

  const pickLoc = (item) => {
    setCidadeObj(item);
    setCidadeInput(item.estado ? `${item.n} · Estado` : `${item.n} — ${item.uf}`);
    setCidadeError(false);
    setShowLocList(false);
  };

  const addBairro = () => {
    const v = bairroInput.trim();
    if (!v) return;
    if (!bairros.some((b) => b.toLowerCase() === v.toLowerCase())) {
      setBairros([...bairros, v]);
    }
    setBairroInput('');
  };

  const removeBairro = (index) => {
    setBairros(bairros.filter((_, i) => i !== index));
  };

  const cidadeLabel = () => {
    if (!cidadeObj) return cidadeInput;
    return cidadeObj.estado ? `${cidadeObj.n} · Estado` : `${cidadeObj.n} — ${cidadeObj.uf}`;
  };

  const handleNext = () => {
    if (isProcessing) return;
    if (step === 1) {
      if (!nicho.trim()) {
        setNichoError(true);
        return;
      }
      setNichoError(false);
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!cidadeInput.trim() && !cidadeObj) {
        setCidadeError(true);
        return;
      }
      setCidadeError(false);
      setStep(3);
      return;
    }
    // Step 3 - Start extraction!
    const neigh = bairros.length > 0 ? bairros.join(', ') : '';
    const city = cidadeObj ? (cidadeObj.estado ? cidadeObj.n : `${cidadeObj.n}, ${cidadeObj.uf}`) : cidadeInput;
    onStartExtraction?.({
      niche: nicho.trim(),
      neigh,
      city,
      limit: 1000
    });
    onClose();
  };

  return (
    <div className="overlay on modal-overlay" onClick={onClose} style={{ display: 'grid' }}>
      <div className="modal modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
        <div className="modal-head">
          <div className="eyebrow">Etapa {step} de 3</div>
          <h2 id="mTitle" style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>
            {wzTitles[step]}
          </h2>
        </div>

        <div className="modal-body" style={{ gridTemplateColumns: '1fr', padding: '16px 20px' }}>
          <div className="wz-dots" aria-hidden="true">
            <i className={step >= 1 ? 'on' : ''} />
            <i className={step >= 2 ? 'on' : ''} />
            <i className={step >= 3 ? 'on' : ''} />
          </div>

          {/* STEP 1: NICHO */}
          {step === 1 && (
            <div className="wz-step">
              <div className={`field ${nichoError ? 'invalid' : ''}`}>
                <label htmlFor="wzNicho">Nicho</label>
                <div className="ac-wrap">
                  <input
                    id="wzNicho"
                    placeholder="Ex.: dentistas, advogados, pizzarias"
                    autoComplete="off"
                    value={nicho}
                    onChange={(e) => handleNichoChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleNext();
                      }
                    }}
                    autoFocus
                  />
                  {showNichoList && nichoSuggestions.length > 0 && (
                    <div className="ac-list" role="listbox">
                      {nichoSuggestions.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="ac-item"
                          onClick={() => pickNicho(item)}
                        >
                          <span><span>{item}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {nichoError && <span className="field-err" style={{ display: 'block' }}>Diga o nicho para continuar.</span>}
              </div>

              <div className="car" style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="car-nav"
                  onClick={() => carViewRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}
                  aria-label="Sugestões anteriores"
                >
                  ‹
                </button>
                <div className="car-view" ref={carViewRef} role="list">
                  {NICHOS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="chip"
                      onClick={() => pickNicho(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="car-nav"
                  onClick={() => carViewRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}
                  aria-label="Próximas sugestões"
                >
                  ›
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: CIDADE */}
          {step === 2 && (
            <div className="wz-step">
              <div className={`field ${cidadeError ? 'invalid' : ''}`}>
                <label htmlFor="wzCidade">Cidade ou estado</label>
                <div className="ac-wrap">
                  <input
                    id="wzCidade"
                    placeholder="Ex.: Rio de Janeiro, São Paulo, Curitiba"
                    autoComplete="off"
                    value={cidadeInput}
                    onChange={(e) => handleLocChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleNext();
                      }
                    }}
                    autoFocus
                  />
                  {showLocList && locSuggestions.length > 0 && (
                    <div className="ac-list" role="listbox">
                      {locSuggestions.map((c) => (
                        <button
                          key={`${c.n}-${c.uf}`}
                          type="button"
                          className="ac-item"
                          onClick={() => {
                            pickLoc(c);
                            setStep(3);
                          }}
                        >
                          <span>
                            <span>{c.n} — {c.uf}</span>
                            <small>{c.estado ? 'Estado' : 'Município'}</small>
                          </span>
                          <span className="t">{c.estado ? 'Estado' : 'Município'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {cidadeError && <span className="field-err" style={{ display: 'block' }}>Escolha uma localização para continuar.</span>}
              </div>

              <div className="ex-chips" style={{ marginTop: '12px' }}>
                {POP_CITIES.map((name) => {
                  const hit = CIDADES.find((c) => c.n === name);
                  if (!hit) return null;
                  return (
                    <button
                      key={name}
                      type="button"
                      className="chip"
                      onClick={() => {
                        pickLoc(hit);
                        setStep(3);
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: BAIRROS */}
          {step === 3 && (
            <div className="wz-step">
              <div className="field">
                <label htmlFor="wzBairro">Bairros (opcional — deixe em branco para o município inteiro)</label>
                <div className="hood-add">
                  <input
                    id="wzBairro"
                    placeholder="Ex.: Copacabana, Pinheiros, Centro"
                    autoComplete="off"
                    value={bairroInput}
                    onChange={(e) => setBairroInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addBairro();
                      }
                    }}
                    autoFocus
                  />
                  <button type="button" className="btn btn-sm" onClick={addBairro}>
                    + Adicionar
                  </button>
                </div>
              </div>

              <div className="hood-list">
                {bairros.map((h, idx) => (
                  <div key={h} className="hood-row">
                    <span>{h}</span>
                    <button type="button" onClick={() => removeBairro(idx)} aria-label={`Remover ${h}`}>
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="wz-review" style={{ marginTop: '12px' }}>
                <b>{nicho || '—'}</b>
                <span> · {cidadeLabel()} · {bairros.length ? `${bairros.length} bairro(s)` : 'município inteiro'}</span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" id="mCancel" onClick={onClose}>
            Cancelar
          </button>
          <span style={{ flex: 1 }} />
          {step > 1 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              Voltar
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={isProcessing} onClick={handleNext}>
            {isProcessing ? 'Extração em andamento…' : (step === 3 ? 'Iniciar extração' : 'Continuar')}
          </button>
        </div>
      </div>
    </div>
  );
}
