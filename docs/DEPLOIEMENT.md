# Mettre TickUp en ligne sur le VPS

À la fin de ce guide : **https://tickup.antoinequarroz.ch**. Même principe que Cairn et Cordée : TickUp tourne dans Docker et passe par le Caddy de Metricove, qui tient déjà les ports 80 et 443.

Ce guide n'a pas encore été déroulé sur le VPS : les commandes sont celles de Cairn, adaptées.

## 1. DNS

Un enregistrement **A** `tickup` qui pointe vers l'IP du VPS. Pour vérifier : `dig +short tickup.antoinequarroz.ch`.

## 2. Installer TickUp

```bash
git clone https://github.com/antoinequarroz/tickup ~/tickup
cd ~/tickup
cp .env.example .env
nano .env
```

Remplis au moins :

```env
API_TOKEN=<openssl rand -hex 32>
# Facultatif : relier GitHub (voir « Relier GitHub » dans le README)
GITHUB_WEBHOOK_SECRET=<openssl rand -hex 32>
APP_URL=https://tickup.antoinequarroz.ch
CORDEE_URL=https://cordee.antoinequarroz.ch
CAIRN_URL=https://cairn.antoinequarroz.ch
```

Puis :

```bash
cd deploy
docker compose up -d --build
```

TickUp écoute maintenant sur `172.17.0.1:3040` : joignable par les autres conteneurs du VPS, pas depuis Internet. Pour vérifier : `curl -I http://172.17.0.1:3040/login` doit répondre `200`.

## 3. Brancher le Caddy de Metricove

Dans `~/metricove/deploy/Caddyfile`, ajoute :

```caddy
tickup.antoinequarroz.ch {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy host.docker.internal:3040 {
		flush_interval -1
	}
}
```

`flush_interval -1` laisse passer les mises à jour en direct. Puis recharge Caddy :

```bash
cd ~/metricove/deploy
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Si Caddy répond « 502 » : `host.docker.internal` ne correspond pas à `172.17.0.1` sur ce VPS. Cherche la bonne adresse avec `docker compose exec caddy getent hosts host.docker.internal`, mets-la dans `TICKUP_BIND` (dans `~/tickup/.env` exporté, ou devant la commande : `TICKUP_BIND=… docker compose up -d`).

## 4. Premier lancement

Ouvre https://tickup.antoinequarroz.ch **tout de suite** et crée ton compte : la première personne qui arrive devient administratrice. Ajoute ensuite les membres dans Réglages.

Dans le `.env` de Cordée, ajoute `TICKUP_URL=https://tickup.antoinequarroz.ch` pour que TickUp apparaisse dans ses modules.

## 5. Sauvegardes

```bash
~/tickup/deploy/backup.sh                 # écrit dans ~/tickup-backups, garde les 14 dernières
```

Chaque nuit à 3 h 10, avec cron (`crontab -e`) :

```cron
10 3 * * * $HOME/tickup/deploy/backup.sh >> $HOME/tickup-backups.log 2>&1
```

Pour restaurer : arrête TickUp, décompresse la sauvegarde dans le volume `tickup-data` sous le nom `tickup.db`, relance.

## 6. Mettre à jour

```bash
cd ~/tickup && git pull
cd deploy && docker compose up -d --build
```

Les données sont dans le volume Docker `tickup-data`, elles ne bougent pas.
