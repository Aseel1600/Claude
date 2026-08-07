# Context Relay (Italiano)

🌐 **Lingue:** 🌐 [English](../../../../../docs/features/context-relay.md) · [es](../../../es/docs/features/context-relay.md) · [fr](../../../fr/docs/features/context-relay.md) · [de](../../../de/docs/features/context-relay.md) · [it](../../../it/docs/features/context-relay.md) · [ru](../../../ru/docs/features/context-relay.md) · [zh-CN](../../../zh-CN/docs/features/context-relay.md) · [ja](../../../ja/docs/features/context-relay.md) · [ko](../../../ko/docs/features/context-relay.md) · [ar](../../../ar/docs/features/context-relay.md) · [hi](../../../hi/docs/features/context-relay.md) · [in](../../../in/docs/features/context-relay.md) · [th](../../../th/docs/features/context-relay.md) · [vi](../../../vi/docs/features/context-relay.md) · [id](../../../id/docs/features/context-relay.md) · [ms](../../../ms/docs/features/context-relay.md) · [nl](../../../nl/docs/features/context-relay.md) · [pl](../../../pl/docs/features/context-relay.md) · [sv](../../../sv/docs/features/context-relay.md) · [no](../../../no/docs/features/context-relay.md) · [da](../../../da/docs/features/context-relay.md) · [fi](../../../fi/docs/features/context-relay.md) · [pt](../../../pt/docs/features/context-relay.md) · [ro](../../../ro/docs/features/context-relay.md) · [hu](../../../hu/docs/features/context-relay.md) · [bg](../../../bg/docs/features/context-relay.md) · [sk](../../../sk/docs/features/context-relay.md) · [uk-UA](../../../uk-UA/docs/features/context-relay.md) · [he](../../../he/docs/features/context-relay.md) · [phi](../../../phi/docs/features/context-relay.md) · [pt-BR](../../../pt-BR/docs/features/context-relay.md) · [cs](../../../cs/docs/features/context-relay.md) · [tr](../../../tr/docs/features/context-relay.md)

---

`context-relay` è una strategia combo che mantiene la continuità della sessione quando l'account
attivo ruota prima che la conversazione sia terminata.

Il runtime attuale si comporta come il routing per-priorità per la selezione del modello, aggiungendo
inoltre un livello di handoff sopra:

- prima che l'account attivo sia esaurito, OmniRoute genera un riepilogo strutturato e compatto
- dopo che l'autenticazione seleziona un account diverso per la stessa sessione, OmniRoute inietta
  quel riepilogo come messaggio di sistema nella richiesta successiva
- una volta che l'handoff viene consumato con successo, viene rimosso dallo storage

## Quando Usarlo

Usa `context-relay` quando sono vere tutte le seguenti condizioni:

- il combo deve ruotare tra più account dello stesso fornitore
- perdere la continuità conversazionale a breve termine danneggerebbe la qualità del compito
- il fornitore espone informazioni sulla quota sufficienti per prevedere un limite d'account imminente

È particolarmente utile per sessioni di sviluppo o ricerca di lunga durata che possono oltrepassare
una singola finestra d'account.

## Flusso di Runtime

Il comportamento attuale è volutamente suddiviso tra due livelli del runtime.

### Quota usata dallo 0% all'84%

Nessun handoff viene generato. Le richieste si comportano come il normale routing per-priorità.

### Quota usata dall'85% al 94%

Se il fornitore attivo è abilitato in `handoffProviders`, OmniRoute genera un riepilogo di handoff
strutturato in background prima che l'account sia completamente esaurito.

Dettagli importanti:

- la soglia di avviso predefinita è `0.85`
- il blocco rigido per la generazione è `0.95`
- è consentita una sola generazione di handoff in corso per `sessionId + comboName`
- se esiste già un handoff attivo per quella sessione/combo, non viene generato un riepilogo duplicato

### Quota usata del 95% o superiore

Nessun nuovo handoff viene generato. A questo punto il sistema è già in o vicino all'esaurimento e
il runtime evita di pianificare un'ulteriore richiesta di riepilogo.

### Dopo la rotazione dell'account

Quando la richiesta successiva per la stessa sessione viene risolta su un account autenticato diverso,
OmniRoute aggiunge in testa l'handoff salvato come messaggio di sistema. L'iniezione avviene solo dopo
che il reale cambio di account è noto.

## Payload dell'Handoff

Il payload dell'handoff persistito è memorizzato in `context_handoffs` e include:

- `sessionId`
- `comboName`
- `fromAccount`
- `summary`
- `keyDecisions`
- `taskProgress`
- `activeEntities`
- `messageCount`
- `model`
- `warningThresholdPct`
- `generatedAt`
- `expiresAt`

Al modello del riepilogo viene chiesto di restituire un oggetto JSON con questa struttura:

```json
{
  "summary": "Riepilogo denso di ciò che conta per la continuità",
  "keyDecisions": ["Decisione 1", "Decisione 2"],
  "taskProgress": "Cosa è stato fatto, cosa resta da fare e il prossimo passo",
  "activeEntities": ["fileA.ts", "funzionalità X", "provider Y"]
}
```

Al momento dell'iniezione, OmniRoute converte il payload in un messaggio di sistema `<context_handoff>`
in modo che l'account successivo possa proseguire con il contesto locale corretto.

## Configurazione

`context-relay` supporta questi campi di configurazione:

- `handoffThreshold`: soglia di avviso per la generazione del riepilogo, predefinita `0.85`
- `handoffModel`: override facoltativo del modello usato solo per la generazione del riepilogo
- `handoffProviders`: allowlist dei fornitori autorizzati ad attivare la generazione dell'handoff

I valori predefiniti globali possono essere configurati nelle Impostazioni, mentre i valori specifici
della combo possono sovrascriverli nella pagina Combos.

## Nota Architetturale

L'implementazione attuale non usa un gestore autonomo `handleContextRelayCombo`.

Invece:

- `open-sse/services/combo.ts` decide se un turno riuscito deve generare un handoff
- `src/sse/handlers/chat.ts` inietta l'handoff solo dopo che l'autenticazione risolve l'account
  effettivamente usato per la richiesta

Questa separazione è intenzionale nel codebase attuale perché il loop della combo, da solo, non sa
se la richiesta sia rimasta sullo stesso account o sia realmente passata a un altro account.

## Limitazioni

- Il supporto di runtime efficace è attualmente incentrato sulla rotazione della quota di `codex`.
- `handoffProviders` è già modellato come superficie di configurazione, ma la generazione effettiva
  dell'handoff dipende ancora dal plumbing della quota specifico del fornitore.
- Il riepilogo è volutamente compatto e basato sulla cronologia recente; non è un meccanismo di
  riproduzione completa del trascritto.
- Gli handoff sono limitati da `sessionId + comboName` e scadono automaticamente.
- Se la sessione non passa a un account diverso, l'handoff memorizzato non viene iniettato.

## Modello di Uso Raccomandato

- usa più account dello stesso fornitore
- mantieni valori `sessionId` stabili per tutta la sessione
- imposta `handoffThreshold` abbastanza presto da lasciare spazio alla richiesta di riepilogo in background
- tratta la funzionalità come un'assistenza alla continuità, non come un sostituto della memoria persistente
