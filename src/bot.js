import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from './storage.js';
import { discoverRandomMovie, searchMovieById, searchMovieByName, searchMovieSuggestions } from './movieService.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || null;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!DISCORD_TOKEN || !CLIENT_ID || !TMDB_API_KEY) {
  console.error('Defina DISCORD_TOKEN, CLIENT_ID e TMDB_API_KEY no .env antes de iniciar.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storagePath = path.join(__dirname, '..', 'data', 'filmobot-db.json');
const storage = new Storage(storagePath);
const removedOmdbItems = storage.purgeLegacyOmdbData();
if (removedOmdbItems > 0) {
  console.log(`Removidos ${removedOmdbItems} filme(s) legados da OMDb do banco local.`);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const starButtons = (discordUserId, movieId) => {
  const buttons = [1, 2, 3, 4, 5].map((value) =>
    new ButtonBuilder()
      .setCustomId(`rate|${discordUserId}|${movieId}|${value}`)
      .setLabel('⭐'.repeat(value))
      .setStyle(ButtonStyle.Primary)
  );

  return new ActionRowBuilder().addComponents(buttons);
};

const linkButton = (discordUserId) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`link|${discordUserId}`)
      .setLabel('Vincular conta Discord')
      .setStyle(ButtonStyle.Success)
  );

const isLinked = (id) => storage.isLinked(id);

const starsText = (value) => `${'⭐'.repeat(value)} (${value})`;

const ratingStats = (movieId) => {
  const movie = storage.getMovie(movieId);
  const scores = movie ? Object.values(movie.ratings || {}) : [];
  if (!scores.length) return { average: null, count: 0 };

  const count = scores.length;
  const average =
    Math.round((scores.reduce((sum, value) => sum + Number(value), 0) / count) * 10) / 10;

  return { average, count };
};

const averageLabel = (movieId) => {
  const { average, count } = ratingStats(movieId);
  if (count === 0) return 'Filme ainda não possui avaliações';
  return `${'⭐'.repeat(Math.round(average))} (${average}) · ${count} avaliação(ões)`;
};

const buildMovieEmbed = (movie, showRatings = false) => {
  const { average, count } = ratingStats(movie.id);
  const embed = new EmbedBuilder()
    .setColor(0x4f46e5)
    .setTitle(`🎬 ${movie.title}`)
    .setDescription(movie.overview)
    .setThumbnail(movie.poster || null)
    .addFields(
      { name: 'Ano', value: movie.year || 'N/A', inline: true },
      { name: 'Gênero', value: movie.genres?.length ? movie.genres.join(', ') : 'N/A', inline: true },
      { name: 'Nota média', value: count ? `${average}/5` : 'Filme ainda não possui avaliações' }
    );

  if (showRatings) {
    const entries = Object.entries(movie.ratings || {});
    if (!entries.length) {
      embed.addFields({ name: 'Avaliações', value: 'Filme ainda não possui avaliações', inline: false });
    } else {
      const list = entries
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([userId, stars]) => `<@${userId}> — ${starsText(stars)}`)
        .join('\n');

      const chunks = list.match(/.{1,950}/g) || [list];
      chunks.forEach((chunk, index) => {
        embed.addFields({
          name: index === 0 ? 'Nota de usuários' : 'Nota de usuários (continuação)',
          value: chunk,
          inline: false
        });
      });
    }
  }

  if (count === 0) {
    embed.setFooter({ text: 'Filme ainda não possui avaliações.' });
  } else {
    embed.setFooter({ text: `Avaliações: ${count} · Média: ${average}/5` });
  }

  return embed;
};

const buildLinkEmbed = () =>
  new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('Conta não vinculada')
    .setDescription(
      'Antes de usar o bot, vincule sua conta clicando no botão abaixo.'
    );

const resolveMovieInput = (rawValue) => {
  if (rawValue.startsWith('id:')) {
    return { movieId: rawValue.replace('id:', '') };
  }
  return { title: rawValue };
};

const ensureMovieLoaded = async (input) => {
  const target = resolveMovieInput(input);
  const movie = target.movieId
    ? await searchMovieById(target.movieId, TMDB_API_KEY)
    : await searchMovieByName(target.title, TMDB_API_KEY);

  if (!movie) return null;
  return storage.upsertMovie(movie);
};

const getLocalMovieSuggestions = (query) => {
  const normalized = query.toLowerCase();
  return storage
    .allMovies()
    .filter((movie) => (movie.title || '').toLowerCase().includes(normalized))
    .slice(0, 25)
    .map((movie) => ({
      id: movie.id,
      title: movie.title,
      year: movie.year || 'N/A'
    }));
};

const commands = [
  new SlashCommandBuilder()
    .setName('info')
    .setDescription('Mostra informações de um filme')
    .addStringOption((option) =>
      option
        .setName('nome')
        .setDescription('Nome do filme')
        .setAutocomplete(true)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('avaliacoes')
    .setDescription('Mostra todas as avaliações de um filme')
    .addStringOption((option) =>
      option
        .setName('nome')
        .setDescription('Nome do filme')
        .setAutocomplete(true)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('avaliar')
    .setDescription('Avalie um filme com 1 a 5 estrelas')
    .addStringOption((option) =>
      option
        .setName('nome')
        .setDescription('Nome do filme')
        .setAutocomplete(true)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resenha')
    .setDescription('Adiciona ou atualiza sua resenha de um filme')
    .addStringOption((option) =>
      option
        .setName('nome')
        .setDescription('Nome do filme')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('texto')
        .setDescription('Sua resenha (até 1000 caracteres)')
        .setMaxLength(1000)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resenhas')
    .setDescription('Mostra todas as resenhas de um filme')
    .addStringOption((option) =>
      option
        .setName('nome')
        .setDescription('Nome do filme')
        .setAutocomplete(true)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resenhas-usuario')
    .setDescription('Mostra todas as resenhas de um usuário')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Usuário para consultar resenhas')
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName('meus-filmes').setDescription('Filmes que você já avaliou'),

  new SlashCommandBuilder().setName('top').setDescription('Top 10 filmes melhor avaliados'),

  new SlashCommandBuilder()
    .setName('top-usuarios')
    .setDescription('Top 10 usuários com mais avaliações'),

  new SlashCommandBuilder().setName('lista').setDescription('Lista de filmes avaliados do melhor para pior'),

  new SlashCommandBuilder().setName('recomendar').setDescription('Recomenda um filme aleatório que você ainda não avaliou')
];

const registerCommands = async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const payload = commands.map((command) => command.toJSON());

  const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);
  await rest.put(route, { body: payload });
  console.log(`Comandos registrados: ${commands.length}`);
};

client.once(Events.ClientReady, () => {
  console.log(`Bot online como ${client.user?.tag}`);
});

const withLinkGate = async (interaction) => {
  if (isLinked(interaction.user.id)) return true;

  await interaction.reply({
    embeds: [buildLinkEmbed()],
    components: [linkButton(interaction.user.id)],
    ephemeral: true
  });
  return false;
};

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const commandsWithAutocomplete = new Set(['info', 'avaliacoes', 'avaliar', 'resenha', 'resenhas']);
      if (!commandsWithAutocomplete.has(interaction.commandName)) {
        await interaction.respond([]);
        return;
      }

      const focused = interaction.options.getFocused(true);
      const focusedValue = String(
        (typeof focused.value === 'string' && focused.value) ||
        interaction.options.getString('nome') ||
        ''
      ).trim();
      if (focusedValue.length < 2) {
        await interaction.respond([]);
        return;
      }

      const localSuggestions = getLocalMovieSuggestions(focusedValue);
      const remoteSuggestions = await Promise.race([
        searchMovieSuggestions(focusedValue, TMDB_API_KEY).catch(() => []),
        new Promise((resolve) => setTimeout(() => resolve([]), 1200))
      ]);

      const merged = new Map();
      for (const movie of [...localSuggestions, ...remoteSuggestions]) {
        if (!movie?.id || merged.has(movie.id)) continue;
        merged.set(movie.id, movie);
      }

      const choices = [...merged.values()].slice(0, 25).map((movie) => ({
        name: `${movie.title} (${movie.year})`.slice(0, 100),
        value: `id:${movie.id}`
      }));

      await interaction.respond(choices);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const { commandName, user } = interaction;

      if (commandName === 'meus-filmes') {
        if (!await withLinkGate(interaction)) return;

        const list = storage.getUserFilms(user.id);

        if (!list.length) {
          await interaction.reply({
            content: 'Você ainda não avaliou nenhum filme.',
            ephemeral: true
          });
          return;
        }

        const lines = list
          .map((item) => `• **${item.movie.title}** (${item.movie.year}) — ${starsText(item.stars)}`)
          .join('\n');

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x10b981)
              .setTitle('🎞️ Meus filmes')
              .setDescription(lines)
          ]
        });
        return;
      }

      if (commandName === 'top') {
        if (!await withLinkGate(interaction)) return;

        const ranked = storage.getTopMovies(10);

        if (!ranked.length) {
          await interaction.reply({ content: 'Ainda não há avaliações suficientes.', ephemeral: true });
          return;
        }

        const lines = ranked
          .map(
            (item, index) => `${index + 1}. **${item.title}** (${item.year}) · ${item.average}/5 · ${item.count} avaliação(ões)`
          )
          .join('\n');

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xf97316)
              .setTitle('🏆 Top 10 filmes')
              .setDescription(lines)
          ]
        });
        return;
      }

      if (commandName === 'top-usuarios') {
        if (!await withLinkGate(interaction)) return;

        const ranked = storage.getTopUsers(10);

        if (!ranked.length) {
          await interaction.reply({ content: 'Ainda não há avaliações suficientes.', ephemeral: true });
          return;
        }

        const lines = ranked
          .map((item, index) => `${index + 1}. <@${item.userId}> — **${item.total}** avaliações`)
          .join('\n');

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x0ea5e9)
              .setTitle('👤 Top usuários')
              .setDescription(lines)
          ]
        });
        return;
      }

      if (commandName === 'lista') {
        if (!await withLinkGate(interaction)) return;

        const ranked = storage.getTopMovies(storage.allMovies().length);

        if (!ranked.length) {
          await interaction.reply({ content: 'Ainda não há avaliações cadastradas.', ephemeral: true });
          return;
        }

        const lines = ranked
          .map((item, index) => `${index + 1}. **${item.title}** (${item.year}) — ${item.average}/5 · ${item.count} voto(s)`)
          .join('\n');

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x8b5cf6)
              .setTitle('📋 Filmes avaliados (melhor para pior)')
              .setDescription(lines)
          ]
        });
        return;
      }

      if (commandName === 'recomendar') {
        if (!await withLinkGate(interaction)) return;

        const ratedIds = new Set(storage.getRatedMoviesByUser(user.id).map((movie) => String(movie.id)));
        const unratedKnownIds = new Set(storage.getUnratedMoviesByUser(user.id).map((movie) => String(movie.id)));
        const lastRecommendedId = storage.getLastRecommendedMovieId(user.id);
        const excludedIds = [...new Set([...ratedIds, ...unratedKnownIds])];
        if (lastRecommendedId) excludedIds.push(String(lastRecommendedId));

        const discovered = await discoverRandomMovie(TMDB_API_KEY, excludedIds);
        if (!discovered) {
          await interaction.reply({
            content: 'Não encontrei recomendações novas no TMDB agora. Tente novamente em instantes.',
            ephemeral: true
          });
          return;
        }

        const movie = storage.upsertMovie(discovered);
        storage.setLastRecommendedMovieId(user.id, movie.id);
        await interaction.reply({
          embeds: [buildMovieEmbed(movie, false)]
        });
        return;
      }

      if (commandName === 'resenhas-usuario') {
        const targetUser = interaction.options.getUser('usuario', true);
        const reviews = storage.getReviewsByUser(targetUser.id);

        if (!reviews.length) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x64748b)
                .setTitle(`🗒️ Resenhas de ${targetUser.username}`)
                .setDescription('Esse usuário ainda não escreveu resenhas.')
                .setThumbnail(targetUser.displayAvatarURL())
            ]
          });
          return;
        }

        const formatted = reviews
          .sort((a, b) => {
            const at = a.updatedAt || a.createdAt || '';
            const bt = b.updatedAt || b.createdAt || '';
            return bt.localeCompare(at);
          })
          .map((item) => `**${item.movie.title}** (${item.movie.year || 'N/A'})\n${item.text}`)
          .join('\n\n');

        const chunks = formatted.match(/[\s\S]{1,3800}/g) || [formatted];
        const embeds = chunks.map((chunk, index) =>
          new EmbedBuilder()
            .setColor(0x0ea5e9)
            .setTitle(index === 0 ? `🗒️ Resenhas de ${targetUser.username}` : '🗒️ Resenhas (continuação)')
            .setDescription(chunk)
            .setThumbnail(index === 0 ? targetUser.displayAvatarURL() : null)
        );

        await interaction.reply({ embeds });
        return;
      }

      const commandsWithMovieName = new Set(['info', 'avaliacoes', 'avaliar', 'resenha', 'resenhas']);
      if (!commandsWithMovieName.has(commandName)) {
        await interaction.reply({
          content: 'Comando não reconhecido para este fluxo.',
          ephemeral: true
        });
        return;
      }

      const name = interaction.options.getString('nome', true);
      const loaded = await ensureMovieLoaded(name);
      if (!loaded) {
        await interaction.reply({
          content: 'Não encontrei esse filme. Tente outro nome.',
          ephemeral: true
        });
        return;
      }

      if (!await withLinkGate(interaction)) return;

      if (commandName === 'info') {
        await interaction.reply({ embeds: [buildMovieEmbed(loaded, false)] });
        return;
      }

      if (commandName === 'avaliacoes') {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`📝 Avaliações de ${loaded.title}`)
              .setColor(0x14b8a6)
              .setDescription(averageLabel(loaded.id))
              .setThumbnail(loaded.poster || null)
              .addFields(
                { name: 'Ano', value: loaded.year || 'N/A', inline: true },
                { name: 'Gêneros', value: loaded.genres?.length ? loaded.genres.join(', ') : 'N/A', inline: true }
              )
          ]
        });

        const movie = storage.getMovie(loaded.id);
        const ratings = movie?.ratings ? Object.entries(movie.ratings) : [];
        if (!ratings.length) {
          await interaction.followUp({
            content: 'Filme ainda não possui avaliações.',
            ephemeral: true
          });
          return;
        }

        const ratingLines = ratings
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .map(([userId, stars]) => `<@${userId}> — ${starsText(stars)}`)
          .join('\n');

        await interaction.followUp({ embeds: [
          new EmbedBuilder()
            .setColor(0x0ea5e9)
            .setDescription(ratingLines)
            .setTitle(`👥 Notas de usuários`) ]});
        return;
      }

      if (commandName === 'resenha') {
        const reviewText = interaction.options.getString('texto', true).trim();
        if (!reviewText) {
          await interaction.reply({
            content: 'A resenha não pode estar vazia.',
            ephemeral: true
          });
          return;
        }

        const previousReview = storage.getMovieReviews(loaded.id).find((item) => item.userId === user.id);
        storage.setReview(user.id, loaded.id, reviewText);

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x22c55e)
              .setTitle(`📝 Resenha ${previousReview ? 'atualizada' : 'adicionada'}`)
              .setDescription(`Filme: **${loaded.title}**\n\n${reviewText}`)
              .setFooter({ text: `Autor: ${interaction.user.username}` })
          ],
          ephemeral: true
        });
        return;
      }

      if (commandName === 'resenhas') {
        const reviews = storage.getMovieReviews(loaded.id);
        if (!reviews.length) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x64748b)
                .setTitle(`🗒️ Resenhas de ${loaded.title}`)
                .setDescription('Filme ainda não possui resenhas.')
                .setThumbnail(loaded.poster || null)
            ],
            ephemeral: true
          });
          return;
        }

        const formatted = reviews
          .sort((a, b) => {
            const at = a.updatedAt || a.createdAt || '';
            const bt = b.updatedAt || b.createdAt || '';
            return bt.localeCompare(at);
          })
          .map((item) => `**<@${item.userId}>**\n${item.text}`)
          .join('\n\n');

        const chunks = formatted.match(/[\s\S]{1,3800}/g) || [formatted];
        const embeds = chunks.map((chunk, index) =>
          new EmbedBuilder()
            .setColor(0x0ea5e9)
            .setTitle(index === 0 ? `🗒️ Resenhas de ${loaded.title}` : `🗒️ Resenhas (continuação)`)
            .setDescription(chunk)
            .setThumbnail(index === 0 ? loaded.poster || null : null)
        );

        await interaction.reply({ embeds });
        return;
      }

      if (commandName === 'avaliar') {
        if (storage.hasRating(user.id, loaded.id)) {
          await interaction.reply({
            content: 'Você já avaliou este filme. Cada usuário pode avaliar somente uma vez.',
            ephemeral: true
          });
          return;
        }

        await interaction.reply({
          content: `Escolha uma nota para **${loaded.title}**:`,
          components: [starButtons(user.id, loaded.id)],
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (customId.startsWith('link|')) {
        const [, targetId] = customId.split('|');
        if (interaction.user.id !== targetId) {
          await interaction.reply({
            content: 'Esse botão foi criado para outro usuário.',
            ephemeral: true
          });
          return;
        }

        storage.linkUser(targetId);
        await interaction.update({
          content: 'Conta vinculada com sucesso! Agora você pode usar todos os comandos.',
          embeds: [],
          components: []
        });
        return;
      }

      if (customId.startsWith('rate|')) {
        const [, targetId, movieId, starsTextValue] = customId.split('|');
        if (interaction.user.id !== targetId) {
          await interaction.reply({
            content: 'Você não pode votar no card de outro usuário.',
            ephemeral: true
          });
          return;
        }

        if (!isLinked(targetId)) {
          await interaction.reply({
            embeds: [buildLinkEmbed()],
            components: [linkButton(targetId)],
            ephemeral: true
          });
          return;
        }

        const stars = Number(starsTextValue);
        const movie = storage.getMovie(movieId);
        if (!movie) {
          await interaction.update({
            content: 'Este filme não está mais disponível para avaliação.',
            components: []
          });
          return;
        }

        const success = storage.setRating(targetId, movieId, stars);
        if (!success) {
          await interaction.update({
            content: `Você já avaliou **${movie.title}** anteriormente.`,
            components: []
          });
          return;
        }

        const { average, count } = ratingStats(movieId);
        await interaction.update({
          content: `✅ Voto registrado: **${movie.title}** com ${'⭐'.repeat(stars)} (${stars}/5).`,
          embeds: [
            new EmbedBuilder()
              .setColor(0x22c55e)
              .setTitle(`Avaliação registrada`)
              .setDescription(`A média do filme agora é **${average}/5** com **${count}** avaliação(ões).`)
          ],
          components: []
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';

    if (interaction.isAutocomplete()) {
      try {
        await interaction.respond([]);
      } catch {
      }
      return;
    }

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: `Erro: ${message}`,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: `Erro: ${message}`,
        ephemeral: true
      });
    }
  }
});

await registerCommands();
await client.login(DISCORD_TOKEN);
