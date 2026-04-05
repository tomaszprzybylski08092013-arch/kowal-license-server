# Kowal License Server

Backend API do obslugi licencji moda Kowal-Helper.

## Start

1. Skopiuj `.env.example` do `.env`
2. Ustaw `ADMIN_API_KEY`
3. Ustaw `DATABASE_URL`
3. Opcjonalnie ustaw `DISCORD_WEBHOOK_URL`
4. Zainstaluj zaleznosci: `npm install`
5. Uruchom: `npm start`

Serwer domyslnie startuje na `http://127.0.0.1:3000`.

## Railway

Na Railway najlepiej dodac usluge PostgreSQL i ustawic zmienna `DATABASE_URL`
na wartosc dostarczona przez Railway.
