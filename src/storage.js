import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DATA = {
  users: {},
  movies: {}
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
      return {
        users: parsed.users || {},
        movies: parsed.movies || {}
      };
    } catch {
      return structuredClone(DEFAULT_DATA);
    }
  }

  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  isLinked(discordId) {
    return Boolean(this.data.users[discordId]);
  }

  linkUser(discordId) {
    if (!this.isLinked(discordId)) {
      this.data.users[discordId] = {
        discordId,
        createdAt: new Date().toISOString(),
        lastRecommendedMovieId: null
      };
      this.save();
    }
    return this.data.users[discordId];
  }

  upsertMovie(movie) {
    const id = String(movie.id);
    const existing = this.data.movies[id] || {};

    this.data.movies[id] = {
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
    return this.data.movies[id];
  }

  getMovie(id) {
    return this.data.movies[String(id)] || null;
  }

  setRating(discordId, movieId, stars) {
    const movie = this.getMovie(movieId);
    if (!movie) return false;
    if (movie.ratings[discordId]) return false;

    movie.ratings[discordId] = stars;
    this.save();
    return true;
  }

  hasRating(discordId, movieId) {
    const movie = this.getMovie(movieId);
    return Boolean(movie && movie.ratings && movie.ratings[discordId]);
  }

  getUserRating(discordId, movieId) {
    const movie = this.getMovie(movieId);
    return movie?.ratings?.[discordId] || null;
  }

  setReview(discordId, movieId, text) {
    const movie = this.getMovie(movieId);
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

  getMovieReviews(movieId) {
    const movie = this.getMovie(movieId);
    if (!movie?.reviews) return [];

    return Object.entries(movie.reviews).map(([userId, review]) => ({
      userId,
      text: review?.text || '',
      createdAt: review?.createdAt || null,
      updatedAt: review?.updatedAt || null
    }));
  }

  getReviewsByUser(discordId) {
    return this.allMovies()
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

  allMovies() {
    return Object.values(this.data.movies);
  }

  getUserFilms(discordId) {
    return this.allMovies()
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

  getTopMovies(limit = 10) {
    return this.allMovies()
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

  getTopUsers(limit = 10) {
    const counts = new Map();

    for (const movie of this.allMovies()) {
      for (const userId of Object.keys(movie.ratings || {})) {
        counts.set(userId, (counts.get(userId) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([userId, total]) => ({ userId, total }))
      .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId))
      .slice(0, limit);
  }

  getRatedMoviesByUser(discordId) {
    return this.allMovies().filter((movie) => movie.ratings && movie.ratings[discordId]);
  }

  getUnratedMoviesByUser(discordId) {
    return this.allMovies().filter((movie) => !movie.ratings || !movie.ratings[discordId]);
  }

  purgeLegacyOmdbData() {
    let removedCount = 0;
    const removedMovieIds = new Set();

    for (const [movieId, movie] of Object.entries(this.data.movies)) {
      const idAsString = String(movieId);
      const poster = String(movie?.poster || '');
      const isImdbId = idAsString.startsWith('tt');
      const isAmazonPoster = poster.includes('m.media-amazon.com');
      if (isImdbId || isAmazonPoster) {
        delete this.data.movies[movieId];
        removedMovieIds.add(idAsString);
        removedCount += 1;
      }
    }

    for (const user of Object.values(this.data.users)) {
      if (!user) continue;
      const last = user.lastRecommendedMovieId ? String(user.lastRecommendedMovieId) : null;
      if (last && removedMovieIds.has(last)) {
        user.lastRecommendedMovieId = null;
      }
    }

    if (removedCount > 0) this.save();
    return removedCount;
  }

  getLastRecommendedMovieId(discordId) {
    return this.data.users[discordId]?.lastRecommendedMovieId || null;
  }

  setLastRecommendedMovieId(discordId, movieId) {
    if (!this.data.users[discordId]) this.linkUser(discordId);
    this.data.users[discordId].lastRecommendedMovieId = String(movieId);
    this.data.users[discordId].lastRecommendedAt = new Date().toISOString();
    this.save();
  }
}
