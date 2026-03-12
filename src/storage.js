import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_GUILD_DATA = () => ({
  users: {},
  movies: {}
});

const DEFAULT_DATA = {
  guilds: {}
};

export class Storage {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);

      if (parsed.guilds && typeof parsed.guilds === 'object') {
        return {
          guilds: parsed.guilds
        };
      }

      if (parsed.users || parsed.movies) {
        return {
          guilds: {
            __legacy_global__: {
              users: parsed.users || {},
              movies: parsed.movies || {}
            }
          }
        };
      }

      return structuredClone(DEFAULT_DATA);
    } catch {
      return structuredClone(DEFAULT_DATA);
    }
  }

  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getGuildData(guildId, create = false) {
    if (!guildId) return null;

    const existing = this.data.guilds[guildId];
    if (existing) return existing;

    const legacy = this.data.guilds.__legacy_global__;
    if (legacy && Object.keys(this.data.guilds).length === 1) {
      this.data.guilds[guildId] = legacy;
      delete this.data.guilds.__legacy_global__;
      this.save();
      return this.data.guilds[guildId];
    }

    if (!create) return null;

    this.data.guilds[guildId] = DEFAULT_GUILD_DATA();
    return this.data.guilds[guildId];
  }

  isLinked(guildId, discordId) {
    const guild = this.getGuildData(guildId, false);
    return Boolean(guild?.users?.[discordId]);
  }

  linkUser(guildId, discordId) {
    const guild = this.getGuildData(guildId, true);
    if (!this.isLinked(guildId, discordId)) {
      guild.users[discordId] = {
        discordId,
        createdAt: new Date().toISOString(),
        lastRecommendedMovieId: null
      };
      this.save();
    }
    return guild.users[discordId];
  }

  upsertMovie(guildId, movie) {
    const guild = this.getGuildData(guildId, true);
    const id = String(movie.id);
    const existing = guild.movies[id] || {};

    guild.movies[id] = {
      ...existing,
      id,
      title: movie.title,
      year: movie.year,
      genres: movie.genres,
      overview: movie.overview,
      poster: movie.poster,
      lastUpdated: new Date().toISOString(),
      ratings: existing.ratings || {},
      reviews: existing.reviews || {}
    };
    this.save();
    return guild.movies[id];
  }

  getMovie(guildId, id) {
    const guild = this.getGuildData(guildId, false);
    return guild?.movies?.[String(id)] || null;
  }

  setRating(guildId, discordId, movieId, stars) {
    const movie = this.getMovie(guildId, movieId);
    if (!movie) return false;
    if (movie.ratings[discordId]) return false;

    movie.ratings[discordId] = stars;
    this.save();
    return true;
  }

  hasRating(guildId, discordId, movieId) {
    const movie = this.getMovie(guildId, movieId);
    return Boolean(movie && movie.ratings && movie.ratings[discordId]);
  }

  getUserRating(guildId, discordId, movieId) {
    const movie = this.getMovie(guildId, movieId);
    return movie?.ratings?.[discordId] || null;
  }

  setReview(guildId, discordId, movieId, text) {
    const movie = this.getMovie(guildId, movieId);
    if (!movie) return null;

    const now = new Date().toISOString();
    const existing = movie.reviews?.[discordId];
    if (!movie.reviews) movie.reviews = {};

    movie.reviews[discordId] = {
      text,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    this.save();
    return movie.reviews[discordId];
  }

  getMovieReviews(guildId, movieId) {
    const movie = this.getMovie(guildId, movieId);
    if (!movie?.reviews) return [];

    return Object.entries(movie.reviews).map(([userId, review]) => ({
      userId,
      text: review?.text || '',
      createdAt: review?.createdAt || null,
      updatedAt: review?.updatedAt || null
    }));
  }

  getReviewsByUser(guildId, discordId) {
    return this.allMovies(guildId)
      .map((movie) => {
        const review = movie?.reviews?.[discordId];
        if (!review?.text) return null;

        return {
          movie: {
            id: movie.id,
            title: movie.title,
            year: movie.year,
            poster: movie.poster
          },
          text: review.text,
          createdAt: review.createdAt || null,
          updatedAt: review.updatedAt || null
        };
      })
      .filter(Boolean);
  }

  allMovies(guildId) {
    const guild = this.getGuildData(guildId, false);
    return Object.values(guild?.movies || {});
  }

  getUserFilms(guildId, discordId) {
    return this.allMovies(guildId)
      .map((movie) => {
        if (!movie.ratings || !movie.ratings[discordId]) return null;
        return {
          movie: {
            id: movie.id,
            title: movie.title,
            year: movie.year,
            genres: movie.genres,
            overview: movie.overview,
            poster: movie.poster
          },
          stars: movie.ratings[discordId]
        };
      })
      .filter(Boolean);
  }

  getTopMovies(guildId, limit = 10) {
    return this.allMovies(guildId)
      .map((movie) => {
        const ratings = Object.values(movie.ratings || {});
        const count = ratings.length;
        const average = count
          ? Math.round((ratings.reduce((sum, value) => sum + Number(value), 0) / count) * 10) / 10
          : 0;
        return { ...movie, count, average };
      })
      .filter((item) => item.count > 0)
      .sort((a, b) => {
        if (b.average !== a.average) return b.average - a.average;
        if (b.count !== a.count) return b.count - a.count;
        return b.lastUpdated.localeCompare(a.lastUpdated);
      })
      .slice(0, limit);
  }

  getTopUsers(guildId, limit = 10) {
    const counts = new Map();

    for (const movie of this.allMovies(guildId)) {
      for (const userId of Object.keys(movie.ratings || {})) {
        counts.set(userId, (counts.get(userId) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([userId, total]) => ({ userId, total }))
      .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId))
      .slice(0, limit);
  }

  getRatedMoviesByUser(guildId, discordId) {
    return this.allMovies(guildId).filter((movie) => movie.ratings && movie.ratings[discordId]);
  }

  getUnratedMoviesByUser(guildId, discordId) {
    return this.allMovies(guildId).filter((movie) => !movie.ratings || !movie.ratings[discordId]);
  }

  purgeLegacyOmdbData() {
    let removedCount = 0;
    const removedMovieIds = new Set();

    for (const guild of Object.values(this.data.guilds)) {
      if (!guild?.movies) continue;

      for (const [movieId, movie] of Object.entries(guild.movies)) {
        const idAsString = String(movieId);
        const poster = String(movie?.poster || '');
        const isImdbId = idAsString.startsWith('tt');
        const isAmazonPoster = poster.includes('m.media-amazon.com');
        if (isImdbId || isAmazonPoster) {
          delete guild.movies[movieId];
          removedMovieIds.add(idAsString);
          removedCount += 1;
        }
      }
    }

    for (const guild of Object.values(this.data.guilds)) {
      for (const user of Object.values(guild?.users || {})) {
        const last = user?.lastRecommendedMovieId ? String(user.lastRecommendedMovieId) : null;
        if (last && removedMovieIds.has(last)) {
          user.lastRecommendedMovieId = null;
        }
      }
    }

    if (removedCount > 0) this.save();
    return removedCount;
  }

  getLastRecommendedMovieId(guildId, discordId) {
    const guild = this.getGuildData(guildId, false);
    return guild?.users?.[discordId]?.lastRecommendedMovieId || null;
  }

  setLastRecommendedMovieId(guildId, discordId, movieId) {
    const guild = this.getGuildData(guildId, true);
    if (!guild.users[discordId]) this.linkUser(guildId, discordId);
    guild.users[discordId].lastRecommendedMovieId = String(movieId);
    guild.users[discordId].lastRecommendedAt = new Date().toISOString();
    this.save();
  }
}
