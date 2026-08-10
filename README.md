# 🎬 DooMovie — Movie Discovery Platform

<p align="center">
  <img src="doomovie.png" alt="DooMovie Logo" width="120">
</p>

<p align="center">
  <strong>Discover your next favorite movie.</strong><br>
  A Netflix-inspired movie discovery web app powered by the TMDB API.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/TMDB-01B4E4?style=for-the-badge&logo=themoviedatabase&logoColor=white" alt="TMDB">
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎞️ **Hero Billboard** | Auto-rotating showcase of 5 trending movies with backdrop, synopsis, and quick actions |
| 🔥 **Trending Now** | Browse movies that are currently popular worldwide |
| ⭐ **Top Rated** | Discover the highest-rated films of all time |
| 🇮🇩 **Indonesian Movies** | Dedicated section for Indonesian cinema |
| 🆕 **Coming Soon** | Preview upcoming movie releases |
| 🔍 **Smart Search** | Real-time search with instant dropdown results (debounced) |
| 🏷️ **Genre Filters** | Quick filter chips — tap a genre to filter all carousels instantly |
| 📋 **My List** | Save movies to your personal watchlist (persisted in localStorage) |
| 🎭 **Movie Details** | Cinematic modal with cast, trailer (YouTube embed), and similar movies |
| 🔔 **Toast Notifications** | Slide-in notifications when adding/removing movies from your list |
| 💀 **Skeleton Loading** | Shimmer placeholders while data loads |
| 📱 **Fully Responsive** | Optimized for desktop, tablet, and mobile devices |
| ⬆️ **Scroll to Top** | Floating button to quickly return to the top |

## 🖼️ Preview

> Add your own screenshots here after deploying!

```
📸 Desktop view — Hero billboard with trending movies
📸 Movie detail modal with trailer and cast
📸 Mobile responsive view
```

## 🛠️ Tech Stack

- **HTML5** — Semantic markup
- **CSS3** — Custom properties, glassmorphism, scroll-snap carousels, animations
- **Vanilla JavaScript** — No frameworks, pure ES6+
- **[TMDB API](https://www.themoviedb.org/documentation/api)** — Movie data, images, and trailers
- **[Font Awesome 6](https://fontawesome.com/)** — Icons
- **[Google Fonts (Inter)](https://fonts.google.com/specimen/Inter)** — Typography

## 🚀 Getting Started

### Prerequisites

- A modern web browser (Chrome, Firefox, Edge, Safari)
- A TMDB API key — [Get one here (free)](https://www.themoviedb.org/settings/api)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/doxxy22/doomovie.git
   cd doomovie
   ```

2. **Configure your API key**

   Open `script.js` and replace the API key on line 6:
   ```js
   const API_KEY = 'YOUR_TMDB_API_KEY';
   ```

3. **Run the app**

   Simply open `index.html` in your browser, or use a local server:
   ```bash
   # Using Python
   python -m http.server 8080

   # Using Node.js
   npx http-server -p 8080 -o

   # Using VS Code
   # Install "Live Server" extension and click "Go Live"
   ```

4. **Open in browser**
   ```
   http://localhost:8080
   ```

## 📁 Project Structure

```
doomovie/
├── index.html        # Main HTML file
├── styles.css        # All styles (Netflix-inspired dark theme)
├── script.js         # Application logic (API, carousels, search, etc.)
├── doomovie.png      # App logo / favicon
├── images/           # Local movie poster images
│   ├── oppenheimer.jpeg
│   ├── Spider-Man_ No Way Home.jpeg
│   └── ...
└── README.md         # This file
```

## 🎯 How It Works

1. **Browse** — Scroll through horizontal carousels of movies by category
2. **Filter** — Tap genre chips to filter all sections by genre
3. **Search** — Click the search icon and type to find movies instantly
4. **Explore** — Click any movie card to see details, cast, trailer, and similar films
5. **Save** — Click the **+** button to add movies to **My List** (saved in your browser)
6. **Watch Trailers** — Play embedded YouTube trailers directly in the app

> 💡 Your watchlist is stored in `localStorage` and persists across sessions. It will only be cleared if you manually clear your browser data.

## 🌐 Deployment

This is a static site — deploy it anywhere:

| Platform | How |
|----------|-----|
| **GitHub Pages** | Push to `main` branch → Settings → Pages → Deploy from branch |
| **Netlify** | Drag & drop the project folder into [Netlify Drop](https://app.netlify.com/drop) |
| **Vercel** | Import the GitHub repo at [vercel.com](https://vercel.com) |

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [TMDB](https://www.themoviedb.org/) — Movie data API
- [Font Awesome](https://fontawesome.com/) — Icons
- [Google Fonts](https://fonts.google.com/) — Inter typeface
- Netflix — Design inspiration

---

<p align="center">
  Made by <a href="https://github.com/doxxy22">Rido Anugrah</a>
</p>