# Bot Koala Filmes (Discord)

Bot de avaliação de filmes com Discord + API do TMDB.

## Requisitos
- Node.js 20+
- Bot no Discord com token
- ID do Bot (`CLIENT_ID`)
- API key do TMDB

## Estrutura
- `src/bot.js`: inicialização do bot e handlers de comandos/interações
- `src/storage.js`: persistência local em JSON (`data/filmobot-db.json`)
- `src/movieService.js`: integração com a API de filmes

## Instalação

```bash
npm install
cp .env.example .env
```

Edite o `.env` com seus dados.

```bash
npm start
```

## Variáveis de ambiente

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID` (opcional, recomenda-se em dev)
- `TMDB_API_KEY`

## Comandos

- `/info <nome>`: mostra sinopse, pôster, ano, gênero e média.
- `/avaliacoes <nome>`: mostra as avaliações de todos os usuários.
- `/avaliar <nome>`: abre botões de 1 a 5 estrelas.
- `/resenha <nome> <texto>`: adiciona ou atualiza a sua resenha do filme.
- `/resenhas <nome>`: mostra as resenhas de todos os usuários para o filme.
- `/resenhas-usuario <usuario>`: mostra todas as resenhas de um usuário.
- `/meus-filmes`: lista filmes avaliados pelo usuário.
- `/top`: top 10 filmes.
- `/top-usuarios`: top 10 usuários.
- `/lista`: lista de filmes avaliados do melhor para o pior.
- `/recomendar`: recomenda aleatoriamente um filme ainda não avaliado pelo usuário.

## Regra de vinculação

No primeiro uso, o bot exige o clique em **Vincular conta Discord**. Isso cria o vínculo e libera o uso contínuo.

## Nota
- O nome do comando de avaliações é `/avaliacoes` (sem acento) por limitação dos nomes de comandos.
