const express = require('express');
const cors = require('cors');
const passport = require('passport');
const SpotifyStrategy = require('passport-spotify').Strategy;
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json());
app.use(cors());

let playlistsInfo = {};

let processedCodes = new Set();

passport.use(new SpotifyStrategy({
  clientID: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  callbackURL: 'https://moodster.netlify.app/callback'
}, (accessToken, refreshToken, expires_in, profile, done) => {
  done(null, profile);
}));

app.get('/', (req, res) => {
  console.log(req);
  return res.status(234).send('Server online');
});

app.get('/login', passport.authenticate('spotify', {
  scope: ['user-library-read','user-read-playback-state','user-modify-playback-state','streaming','user-read-email', 'user-read-private', 'playlist-modify-public', 'playlist-modify-private', 'user-top-read'],
  showDialog: true
}));

app.post('/exchange_code', async (req, res) => {
  const { code } = req.body;

  if (processedCodes.has(code)) {
    return res.status(409).send('Código ya procesado.');
  }

  try {
    const tokenResponse = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.REDIRECT_URI,
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }).toString(),
      headers: {'Content-Type': 'application/x-www-form-urlencoded',},
    });

    const accessToken = tokenResponse.data.access_token;

    // Obtener información del usuario, incluido su ID
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    
    const userId = userResponse.data.id;

    processedCodes.add(code);
    setTimeout(() => processedCodes.delete(code), 600000); // Limpiar el código después de un tiempo

    res.json({ accessToken, userId });
  } catch (error) {
    console.error('Error en el intercambio de código:', error);
    res.status(500).send('Error interno del servidor');
  }
});

app.get('/callback', passport.authenticate('spotify', { failureRedirect: '/login' }), (req, res) => {
  res.send('Puede cerrar esta pestaña');
});

// Endpoint para crear una playlist y obtener recomendaciones de Spotify
app.post('/create_playlist', async (req, res) => {
  console.log("Recibiendo solicitud de creación de playlist con:", req.body);
  const { userId, currentMood, desiredMood, artistsToUse, accessToken } = req.body;

  // Validar la entrada
  if (!userId || !currentMood || !desiredMood || !artistsToUse || artistsToUse.length === 0 || !accessToken) {
      return res.status(400).send('Datos incompletos para crear la playlist.');
  }

  try {
      // Crear una nueva playlist
      const playlistName = `Playlist from ${currentMood} to ${desiredMood}`;
      const playlistResponse = await axios.post(`https://api.spotify.com/v1/users/${userId}/playlists`, {
          name: playlistName,
          description: `Playlist personalizada desde ${currentMood} a ${desiredMood}`,
          public: false
      }, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const playlistId = playlistResponse.data.id;

      // Calcular los puntos de transición y obtener recomendaciones
      const allTracks = await getTransitionTracks(currentMood, desiredMood, artistsToUse, accessToken);

      // Añadir pistas recomendadas a la playlist
      await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
          uris: allTracks.map(track => track.uri)
      }, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      console.log("Playlist creada con éxito. ID:", playlistId, "URL:", `https://open.spotify.com/playlist/${playlistId}`);
      res.json({
          playlistId: playlistId,
          message: 'Playlist creada con éxito',
          playlistUrl: `https://open.spotify.com/playlist/${playlistId}`
      });
  } catch (error) {
      console.error('Error al crear playlist:', error);
      res.status(500).send('Error interno del servidor');
  }
});


app.get('/get_playlist_info', (req, res) => {
  const { userId } = req.query; // Obtiene el userId del query param

  const playlistInfo = playlistsInfo[userId];
  if (!playlistInfo) {
    return res.status(404).send('Playlist info not found');
  }

  res.json(playlistInfo);
});

// Función para obtener pistas de transición
async function getTransitionTracks(currentMood, desiredMood, selectedArtists, accessToken) {
  const moodMapping = {
    'Feliz': {
      valence: 1,
      energy: 1,
      danceability: 1,
      acousticness: 0.2,
      instrumentalness: 0.05,
      tempo: 160 
    },
    'Triste': {
      valence: 0.1,
      energy: 0.2,
      danceability: 0.1,
      acousticness: 0.5,
      instrumentalness: 0.2,
      tempo: 40 
    },
    'Energético': {
      valence: 0.7,
      energy: 0.9,
      danceability: 0.8,
      acousticness: 0.1,
      instrumentalness: 0.1,
      tempo: 140 
    },
    'Relajado': {
      valence: 0.5,
      energy: 0.4,
      danceability: 0.4,
      acousticness: 0.6,
      instrumentalness: 0.3,
      tempo: 90 
    },
    'Enojado': {
      valence: 0.3,
      energy: 0.7,
      danceability: 0.5,
      acousticness: 0.1,
      instrumentalness: 0.05,
      tempo: 110 
    }
  }

  const moodToGenreMapping = {
    'Feliz': ['pop', 'dance', 'happy'],
    'Triste': ['sad', 'acoustic', 'rainy-day'],
    'Energético': ['work-out', 'electronic', 'house'],
    'Relajado': ['chill', 'ambient', 'acoustic'],
    'Enojado': ['rock', 'metal', 'hard-rock']
  };
  
  let currentMoodParams = moodMapping[currentMood];
  let desiredMoodParams = moodMapping[desiredMood];
  let currentMoodGenres = moodToGenreMapping[currentMood];
  let desiredMoodGenres = moodToGenreMapping[desiredMood];

  // Verifica si los géneros son arreglos
  if (!Array.isArray(currentMoodGenres)) {
      console.error(`Géneros para el estado de ánimo actual (${currentMood}) no es un arreglo.`);
      currentMoodGenres = []; // asigna un valor por defecto si es necesario
  }

  if (!Array.isArray(desiredMoodGenres)) {
      console.error(`Géneros para el estado de ánimo deseado (${desiredMood}) no es un arreglo.`);
      desiredMoodGenres = []; // asigna un valor por defecto si es necesario
  }

  let allTracks = [];
  const totalTracksNeeded = 20;
  const tracksPerStep = totalTracksNeeded / 10; // Asumiendo 5 pasos de transición por cada mitad

  // Transición de las pistas
  for (let step = 0; step < 10; step++) {
      let weight = step / 9;
      let moodParams = interpolateMoodParams(currentMoodParams, desiredMoodParams, weight);
      let genres = step < 5 ? currentMoodGenres : desiredMoodGenres;

      const recommendations = await getSpotifyRecommendations(moodParams, selectedArtists, genres, accessToken);
      allTracks.push(...recommendations.slice(0, tracksPerStep));
  }

  return allTracks.slice(0, totalTracksNeeded);
}

function interpolateMoodParams(currentMoodParams, desiredMoodParams, weight) {
  let moodParams = {};
  for (let param in currentMoodParams) {
    moodParams[param] = currentMoodParams[param] * (1 - weight) + desiredMoodParams[param] * weight;
  }
  return moodParams;
}

async function getSpotifyRecommendations(moodParams, selectedArtists, genres, accessToken) {
  console.log("Solicitando recomendaciones de Spotify con parámetros:", moodParams, "Artistas:", selectedArtists, "Géneros:", genres);
  try {
    const response = await axios.get('https://api.spotify.com/v1/recommendations', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      params: {
        ...moodParams,
        seed_genres: genres.join(','),
        seed_artists: selectedArtists.slice(0, 2).join(','), // ejemplo con solo dos artistas
        limit: 5 
      }
    });
    console.log("Recomendaciones recibidas:", response.data.tracks.map(track => track.name));
    return response.data.tracks;
  } catch (error) {
    console.error('Error al obtener recomendaciones de Spotify:', error);
    throw error;
  }
}

app.listen(4000, () => console.log('Servidor corriendo en el puerto 4000'));