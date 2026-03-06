const BASE_URL = 'https://www.omdbapi.com/';

function normalize(result) {
  return {
    id: result.imdbID || `${result.Title}-${result.Year}`,
    title: result.Title || 'Título indisponível',
    year: result.Year || 'N/A',
    genres: result.Genre ? result.Genre.split(',').map((genre) => genre.trim()) : [],
    overview: (result.Plot || 'Sinopse não disponível.').trim(),
    poster: result.Poster && result.Poster !== 'N/A' ? result.Poster : null
  };
}

function ensureApiKey(apiKey) {
  if (!apiKey) {
    throw new Error('OMDB_API_KEY não definida. Crie uma chave no OMDb e adicione em .env.');
  }
}

async function fetchOmdb(params, apiKey, { allowNotFound = false } = {}) {
  ensureApiKey(apiKey);

  const url = `${BASE_URL}?apikey=${apiKey}&${params}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('OMDb recusou a chave (401). Verifique OMDB_API_KEY e confirme a ativação por email.');
    }
    throw new Error(`Erro ao buscar filme no OMDb: ${response.status}`);
  }

  if (data.Response === 'False') {
    const message = data.Error || 'Falha ao consultar OMDb.';
    if (allowNotFound && message.toLowerCase().includes('not found')) return null;
    throw new Error(`OMDb: ${message}`);
  }

  return data;
}

export async function searchMovieByName(name, apiKey) {
  const query = encodeURIComponent(name);
  const data = await fetchOmdb(`t=${query}&type=movie&plot=short`, apiKey, { allowNotFound: true });
  if (!data) return null;
  return normalize(data);
}

export async function searchMovieById(id, apiKey) {
  const query = encodeURIComponent(id);
  const data = await fetchOmdb(`i=${query}&type=movie&plot=short`, apiKey, { allowNotFound: true });
  if (!data) return null;
  return normalize(data);
}

export async function searchMovieSuggestions(query, apiKey) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const encoded = encodeURIComponent(query);
  const pages = normalizedQuery.length >= 4 ? [1] : [1, 2];
  const responses = await Promise.all(
    pages.map((page) =>
      fetchOmdb(`s=${encoded}&type=movie&page=${page}`, apiKey, { allowNotFound: true }).catch(() => null)
    )
  );

  const all = responses
    .flatMap((data) => data?.Search || [])
    .filter((item) => item?.imdbID && item?.Title);

  const deduped = new Map();
  for (const item of all) {
    if (deduped.has(item.imdbID)) continue;
    deduped.set(item.imdbID, item);
  }

  const scored = [...deduped.values()]
    .map((item) => {
      const titleLower = item.Title.toLowerCase();
      let score = 0;
      if (titleLower === normalizedQuery) score += 100;
      if (titleLower.startsWith(normalizedQuery)) score += 60;
      if (titleLower.includes(normalizedQuery)) score += 30;
      if (titleLower.startsWith(`${normalizedQuery} `)) score += 10;
      if (titleLower.startsWith(`${normalizedQuery}:`)) score += 10;
      return {
        id: item.imdbID,
        title: item.Title,
        year: item.Year || 'N/A',
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
