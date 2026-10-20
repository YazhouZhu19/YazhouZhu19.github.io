/** Independently fetched publisher feeds; Google remains a separate discovery channel. */
export interface NewsFeedSource {
  id: string;
  name: string;
  publisher: string;
  url: string;
  homepage: string;
  articleHosts: string[];
  aliases: string[];
  groupId: string;
}

export const NEWS_FEED_SOURCES: NewsFeedSource[] = [
  {
    id: "rss-news-mit-imaging",
    name: "MIT News · Imaging RSS",
    publisher: "MIT News",
    url: "https://news.mit.edu/topic/mitimaging-rss.xml",
    homepage: "https://news.mit.edu/topic/imaging",
    articleHosts: ["news.mit.edu"],
    aliases: [
      "MIT News | Massachusetts Institute of Technology",
      "MIT News - Massachusetts Institute of Technology",
      "Massachusetts Institute of Technology",
    ],
    groupId: "medical-imaging",
  },
  {
    id: "rss-news-auntminnie",
    name: "AuntMinnie · RSS",
    publisher: "AuntMinnie",
    url: "https://www.auntminnie.com/feed",
    homepage: "https://www.auntminnie.com/",
    articleHosts: ["auntminnie.com"],
    aliases: ["AuntMinnie.com"],
    groupId: "medical-imaging",
  },
  {
    id: "rss-news-sciencedaily-imaging",
    name: "ScienceDaily · Medical Imaging RSS",
    publisher: "ScienceDaily",
    url: "https://www.sciencedaily.com/rss/health_medicine/medical_imaging.xml",
    homepage: "https://www.sciencedaily.com/news/health_medicine/medical_imaging/",
    articleHosts: ["sciencedaily.com"],
    aliases: ["Science Daily"],
    groupId: "medical-imaging",
  },
  {
    id: "rss-news-nvidia-healthcare",
    name: "NVIDIA · Healthcare and Life Sciences RSS",
    publisher: "NVIDIA Blog",
    url: "https://blogs.nvidia.com/blog/tag/healthcare-life-sciences/feed/",
    homepage: "https://blogs.nvidia.com/blog/tag/healthcare-life-sciences/",
    articleHosts: ["blogs.nvidia.com"],
    aliases: ["NVIDIA", "NVIDIA Blogs"],
    groupId: "medical-imaging",
  },
  {
    id: "rss-news-nvidia-technical",
    name: "NVIDIA Technical Blog · Atom",
    publisher: "NVIDIA Technical Blog",
    url: "https://developer.nvidia.com/blog/feed",
    homepage: "https://developer.nvidia.com/blog/",
    articleHosts: ["developer.nvidia.com"],
    aliases: ["NVIDIA Developer Blog"],
    groupId: "toolkits",
  },
];
