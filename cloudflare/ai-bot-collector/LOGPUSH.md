# Connecter votre trafic Cloudflare à TrustData via Logpush

> Pour les sites sur un plan Cloudflare incluant **Logpush** (Enterprise, ou certains
> plans Pro/Business). Aucun code à déployer, aucun Worker à maintenir : Cloudflare
> pousse les logs de requêtes vers TrustData, qui identifie le trafic IA côté serveur.
>
> Si Logpush n'est pas disponible sur votre plan, utilisez le **Worker** (un clic,
> tous les plans) : voir [README.md](./README.md).

## En bref

1. Vous récupérez une clé d'ingestion `td_cf_…` dans TrustData.
2. Vous créez un job Logpush dans Cloudflare, filtré sur **votre domaine**.
3. Les logs arrivent en moins d'une minute. TrustData classe les bots et les
   visites référées par les moteurs IA, et ignore le reste.

Durée : ~5 minutes, tout dans le tableau de bord Cloudflare.

## Étape 1 — Récupérer votre clé d'ingestion

Dans TrustData : **Organisation → Intégrations** (`/organizations/<votre_org>/#integrations`),
fournisseur **Cloudflare**. Copiez la valeur `td_cf_…`.

> C'est une clé d'ingestion de logs (`td_cf_…`), pas un jeton d'API (`td_live_…`).
> Notez aussi votre **attribution ID** (l'identifiant de la propriété), affiché sur
> la même page.

## Étape 2 — Créer le job Logpush

Tableau de bord Cloudflare → votre zone → **Analytics & Logs → Logpush → Create a job**.

- **Destination** : `HTTP destination`.
- **URL de destination** :
  ```
  https://t.trustdata.tech/v1/logs/cloudflare_logpush?header_X-API-Key=td_cf_VOTRE_CLE&tags=attribution_id=VOTRE_ATTRIBUTION_ID
  ```
  Remplacez `td_cf_VOTRE_CLE` et `VOTRE_ATTRIBUTION_ID`.
- **Dataset** : `HTTP requests`.

## Étape 3 — Filtrer sur votre domaine (important)

Dans **If logs match…**, choisissez **Filtered logs**, puis filtrez sur le champ
`ClientRequestHost` égal à votre domaine.

```
ClientRequestHost  equals  exemple.com
```

> Utilisez **votre** domaine. Ce filtre par hôte garantit que vous n'envoyez que
> le trafic de votre site. La détection des bots IA et des visites référées se fait
> ensuite côté TrustData (reconnaissance des user-agents IA connus + vérification),
> et tout le reste est ignoré à l'ingestion.

### Variante « minimisation des données » (optionnel, EU/RGPD)

Si vous souhaitez ne transmettre **que** les lignes susceptibles d'être de l'IA (au
lieu de tout le trafic du domaine), ajoutez un filtre `OR` sur l'user-agent et le
référent. C'est plus strict côté données personnelles, mais le filtre Logpush est
limité (~30 conditions / ~1000 octets) et sensible à la casse : il ne peut pas être
exhaustif et peut manquer la longue traîne. Pour une couverture complète **et** la
minimisation, préférez le **Worker** (filtrage à l'edge). Nous fournissons un filtre
prêt à coller sur demande.

### Recommandé si vous avez Cloudflare Bot Management

Si votre zone dispose de **Bot Management**, ne filtrez pas par user-agent : filtrez
sur la catégorie de bot **vérifiée** par Cloudflare. C'est plus court, maintenu par
Cloudflare et **déjà validé par IP** (anti-usurpation).

```
VerifiedBotCategory in [AI_CRAWLER, AI_ASSISTANT, AI_SEARCH]
   OR  ClientRequestReferer contains chatgpt
   OR  ClientRequestReferer contains perplexity
   OR  ClientRequestReferer contains claude.ai
   OR  ClientRequestReferer contains gemini
   OR  ClientRequestReferer contains copilot
```

Les trois premières conditions couvrent les **crawlers IA** (vérifiés) ; les filtres
sur le référent captent les **visites humaines référées** par un moteur IA, que la
catégorie de bot ne voit pas. Ajoutez aussi le champ `VerifiedBotCategory` à l'étape
suivante pour qu'il soit transmis.

## Étape 4 — Choisir les champs

Sélectionnez ces champs (réduit le volume, garde tout ce dont TrustData a besoin) :

| Champ | Pourquoi |
|---|---|
| `EdgeStartTimestamp` | Horodatage de la requête |
| `EdgeEndTimestamp` | Durée |
| `ClientIP` | Vérification des bots (anti-usurpation) |
| `ClientRequestHost` | Domaine |
| `ClientRequestMethod` | Méthode HTTP |
| `ClientRequestURI` | Page visitée |
| `ClientRequestUserAgent` | Identification du bot |
| `ClientRequestReferer` | Détection des visites référées par un moteur IA |
| `EdgeResponseStatus` | Bot bloqué / redirigé / servi |
| `EdgeResponseBytes` | Volume servi |
| `VerifiedBotCategory` | *(Bot Management uniquement)* catégorie de bot vérifiée par Cloudflare |

Format : **NDJSON**, compression **gzip** (recommandé).

## Étape 5 — Activer

Cliquez **Save**. Cloudflare envoie un événement de test, puis les logs commencent
à arriver. Les premiers événements IA apparaissent dans votre tableau de bord
TrustData en quelques minutes.

## Vérifier que ça marche

- Cloudflare : le job Logpush est en statut **Enabled** sans erreur de livraison.
- TrustData : les visites de bots IA et les visites référées apparaissent dans la
  page dédiée sous quelques minutes.

## Worker, Logpush filtré ou host-only ?

| | Worker | Logpush host-only | Logpush filtré (UA/référent) |
|---|---|---|---|
| Plans | Tous | Logpush requis | Logpush requis |
| Mise en place | Un clic | 1 filtre (host) | Filtre à coller |
| Code à exécuter | Oui (edge) | Non | Non |
| Bots IA (couverture) | Complète | Complète | Partielle (longue traîne ratée) |
| Visites référées IA | Complète | Complète | Partielle (top moteurs seulement) |
| « % de trafic IA » | ✅ | ❌ | ❌ |
| Découverte de nouveaux bots | ✅ | ⚠️ | ❌ |
| Minimisation des données | ✅✅ | ❌ (firehose reçu) | ✅✅ |

Trois points à retenir :

- **Le filtre pré-fait** est le plus économe en données, mais il ne peut pas être
  exhaustif (limite Cloudflare ~30 conditions / 1000 octets, sensible à la casse).
  Il rate une partie des crawlers de longue traîne et surtout la majorité des
  **domaines référents** au-delà des grands moteurs.
- **Host-only** récupère toute la couverture (bots + référents) car la classification
  se fait côté TrustData, au prix de nous transmettre tout le trafic du domaine.
- **Le dénominateur « part de trafic IA »** et la **découverte de nouveaux bots**
  ne sont possibles qu'avec le **Worker** (échantillon 2% à l'edge).

> **Si vous avez Cloudflare Bot Management :** vous pouvez filtrer le job Logpush sur
> le champ `VerifiedBotCategory` (valeurs `AI_CRAWLER`, `AI_ASSISTANT`, `AI_SEARCH`).
> C'est compact, maintenu par Cloudflare et **déjà vérifié par IP** (anti-usurpation),
> donc supérieur au filtre par user-agent pour les crawlers. Ajoutez un filtre sur le
> référent pour capter aussi les visites humaines référées par un moteur IA.

## Données & sécurité

### Ce qu'on reçoit, traite et stocke

| | Vous nous **envoyez** | On **traite** (transitoire) | On **stocke** |
|---|---|---|---|
| **Worker** | Seulement l'IA + un échantillon 2% anonymisé | idem | Bots & visites IA |
| **Logpush filtré** (UA/référent) | Seulement les lignes IA | idem | Bots & visites IA |
| **Logpush host-only** | Tout le trafic du domaine | tout, puis ~98% ignoré | Bots & visites IA |

Dans tous les cas, **au repos nous ne conservons que les visites de bots et de moteurs
IA**. L'adresse IP client est utilisée à la volée pour la détection puis **jetée** :
**aucune IP de visiteur n'est stockée**.

### RGPD / minimisation

- Une **IP est une donnée personnelle**. Le trafic **bot** ne l'est pas (machines,
  IP de datacenters) ; seul le trafic **humain** est concerné.
- En **Worker** ou **Logpush filtré**, vous ne nous transmettez quasiment que des
  données **non personnelles**. C'est l'option recommandée en contexte EU/CNIL.
- En **Logpush host-only**, vous nous transmettez l'IP/URL de vos visiteurs humains
  (que nous ne stockons pas). Cette option suppose un **accord de sous-traitance (DPA)**
  en place.

### Sécurité de la clé

La clé `td_cf_…` est une clé **d'écriture seule, scopée à une seule propriété** : si
elle fuitait, un tiers pourrait au pire injecter de faux événements pour cette
propriété, **jamais lire vos données**. Elle est révocable et remplaçable à tout
moment. Le transport est chiffré (TLS).

## Questions fréquentes

**Est-ce que ça ralentit mon site ?** Non. Logpush est asynchrone, hors du chemin
de la requête. Aucune latence ajoutée.

**Quelles données sont conservées ?** TrustData ne conserve que les événements liés
à l'IA (bots et visites référées). Le reste du trafic est ignoré à l'ingestion.

**Logpush ou Worker ?** Logpush si votre plan l'inclut et que vous préférez ne rien
exécuter. Worker sinon (tous les plans, un clic), ou si vous voulez la couverture
complète + la part de trafic IA et la minimisation à l'edge.
