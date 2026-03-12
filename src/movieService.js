const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

function normalize(result) {
  return {
    id: String(result.id),
    title: result.title || 'Título indisponível',
    year: result.release_date ? result.release_date.slice(0, 4) : 'N/A',
    genres: (result.genres || []).map((genre) => genre.name),
    overview: (result.overview || 'Sinopse não disponível.').trim(),
    poster: result.poster_path ? `${IMAGE_BASE}${result.poster_path}` : null
  };
}

function ensureApiKey(apiKey) {
  if (!apiKey) {
    throw new Error('TMDB_API_KEY não definida. Crie uma chave no TMDB e adicione em .env.');
  }
}

async function fetchTmdb(path, apiKey) {
  ensureApiKey(apiKey);

  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${path}${sep}api_key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('TMDB recusou a chave (401). Verifique TMDB_API_KEY no .env.');
    }
    throw new Error(`Erro ao buscar filme no TMDB: ${response.status}`);
  }

  return data;
}

export async function searchMovieByName(name, apiKey) {
  const query = encodeURIComponent(name.trim());
  const search = await fetchTmdb(`/search/movie?language=pt-BR&query=${query}&include_adult=false&page=1`, apiKey);
  const first = search?.results?.[0];
  if (!first) return null;

  const details = await fetchTmdb(`/movie/${first.id}?language=pt-BR`, apiKey);
  return normalize(details);
}

export async function searchMovieById(id, apiKey) {
  const details = await fetchTmdb(`/movie/${encodeURIComponent(id)}?language=pt-BR`, apiKey);
  if (!details?.id) return null;
  return normalize(details);
}

export async function searchMovieSuggestions(query, apiKey) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const encoded = encodeURIComponent(query.trim());
  const data = await fetchTmdb(
    `/search/movie?language=pt-BR&query=${encoded}&include_adult=false&page=1`,
    apiKey
  ).catch(() => null);
  const all = (data?.results || []).filter((item) => item?.id && item?.title);

  const scored = all
    .map((item) => {
      const titleLower = item.title.toLowerCase();
      let score = 0;
      if (titleLower === normalizedQuery) score += 100;
      if (titleLower.startsWith(normalizedQuery)) score += 60;
      if (titleLower.includes(normalizedQuery)) score += 30;
      if (titleLower.startsWith(`${normalizedQuery} `)) score += 10;
      if (titleLower.startsWith(`${normalizedQuery}:`)) score += 10;
      return {
        id: String(item.id),
        title: item.title,
        year: item.release_date ? item.release_date.slice(0, 4) : 'N/A',
        score
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    })
    .slice(0, 25);

  return scored.map(({ id, title, year }) => ({ id, title, year }));
}

export async function discoverRandomMovie(apiKey, excludedIds = []) {
  const excluded = new Set((excludedIds || []).map((id) => String(id)));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const randomPage = Math.floor(Math.random() * 20) + 1;
    const data = await fetchTmdb(
      `/discover/movie?language=pt-BR&include_adult=false&sort_by=popularity.desc&vote_count.gte=100&page=${randomPage}`,
      apiKey
    ).catch(() => null);

    const pool = (data?.results || []).filter((item) => item?.id && !excluded.has(String(item.id)));
    if (!pool.length) continue;

    const picked = pool[Math.floor(Math.random() * pool.length)];
    const details = await fetchTmdb(`/movie/${picked.id}?language=pt-BR`, apiKey).catch(() => null);
    if (details?.id) return normalize(details);
  }

  return null;
}
