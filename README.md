# Everything GPT

> **The world's most powerful open-source AI assistant** — Connected to the entire web of human knowledge: research, news, finance, patents, economics, and more. Ask anything, analyze everything, and discover insights across every domain — all through natural conversation.

🚀 **[Try the live demo at everything.valyu.ai](https://everything.valyu.ai)**

![Everything GPT](public/everything.png)

## Why Everything GPT?

Information is everywhere, but accessing it is fragmented across countless databases, APIs, and platforms. Everything GPT changes that by providing a single, unified interface to the world's knowledge:

- **🌍 Universal Knowledge Access** - Clinical trials, news, financial data, patents, academic research, economics, pharmaceutical intelligence, and more
- **🔍 One Unified Search** - Powered by Valyu's comprehensive data API covering every major domain
- **🐍 Advanced Analytics** - Execute Python code in secure Daytona sandboxes for data analysis, statistical modeling, and visualization
- **📊 Interactive Visualizations** - Beautiful charts for any data - from market trends to research insights
- **🌐 Real-Time Intelligence** - Web search integration for breaking news and current events
- **🏠 Local AI Models** - Run with Ollama for unlimited, private queries using your own hardware
- **🎯 Natural Language** - Just ask questions like you would to a colleague

## Key Features

### 🔥 Universal Data Access

- **Research & Academia** - PubMed literature, ArXiv papers, clinical trials, biomedical databases
- **News & Current Events** - Real-time news from global sources across all topics
- **Financial Data** - Market data, company financials, SEC filings, earnings reports
- **Patents & Innovation** - Patent databases and innovation intelligence
- **Economic Data** - Economic indicators, market analysis, industry research
- **Drug & Healthcare** - FDA drug labels, pharmaceutical pipelines, clinical trial data
- **Business Intelligence** - Wiley finance/business/accounting corpus, company analysis
- **Comprehensive Search** - Cross-reference data across all domains in a single query

### 🛠️ Advanced Tool Calling

- **Python Code Execution** - Run statistical analyses, ML models, data processing, and custom algorithms
- **Interactive Charts** - Create publication-ready visualizations for any dataset
- **Multi-Source Research** - Automatically aggregates data from multiple sources
- **Export & Share** - Download results, share analyses, and collaborate

## 🚀 Quick Start

### Prerequisites

**For Cloud Usage:**
- Node.js 18+
- npm or yarn
- OpenAI API key
- Valyu API key (get one at [platform.valyu.network](https://platform.valyu.network))
- Daytona API key (for code execution)

**For Local AI Models:**
- All of the above, plus:
- [Ollama](https://ollama.com) installed and running
- At least one model installed (qwen2.5:7b recommended)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yorkeccak/bio.git
   cd bio
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Create a `.env.local` file in the root directory:
   ```env
   # OpenAI Configuration
   OPENAI_API_KEY=your-openai-api-key

   # Valyu API Configuration
   VALYU_API_KEY=your-valyu-api-key

   # Daytona Configuration (for Python execution)
   DAYTONA_API_KEY=your-daytona-api-key
   DAYTONA_API_URL=https://api.daytona.io  # Optional
   DAYTONA_TARGET=latest  # Optional

   # App Configuration
   NEXT_PUBLIC_APP_URL=http://localhost:3000  # Your deployment URL in production

   # Ollama Configuration (Optional - for local models)
   # By default, Ollama support is DISABLED for production mode
   # To enable Ollama support, uncomment the line below:
   # NEXT_PUBLIC_APP_MODE=development  # Enable local model support
   OLLAMA_BASE_URL=http://localhost:11434  # Default Ollama URL
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Check your configuration (optional)**
   ```bash
   npm run check-config
   ```
   This will show you whether Ollama support is enabled or disabled.

6. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

### 🏠 Local Model Setup (Optional)

**Note**: By default, Ollama support is **disabled** for production mode. The app will use OpenAI/Vercel AI Gateway with rate limiting (5 queries/day).

For unlimited, private queries using your own hardware:

1. **Install Ollama**
   ```bash
   # macOS
   brew install ollama

   # Or download from https://ollama.com
   ```

2. **Start Ollama service**
   ```bash
   ollama serve
   ```

3. **Install recommended models**
   ```bash
   # Best for tool calling (recommended)
   ollama pull qwen2.5:7b

   # Alternative options
   ollama pull qwen2.5:14b    # Better but slower
   ollama pull llama3.1:7b    # Good general performance
   ```

4. **Switch to local model**

   Click the "Local Models" indicator in the top-right corner of the app to select your model.

**Model Recommendations:**
- **Qwen2.5:7B+** - Excellent for tool calling and complex analysis
- **Llama 3.1:7B+** - Good general performance with tools
- **Avoid smaller models** - Many struggle with complex function calling

## 💡 Example Queries

Everything GPT can answer questions across all domains:

**Research & Science:**
- "Search for Phase 3 clinical trials for melanoma immunotherapy"
- "What are the latest breakthroughs in quantum computing from ArXiv?"
- "Analyze recent CRISPR gene editing research from PubMed"

**Finance & Business:**
- "Analyze Apple's revenue trends over the past 5 years"
- "What are the latest SEC filings for Tesla?"
- "Compare market performance of tech stocks vs energy sector"

**News & Current Events:**
- "What are the top global news stories today?"
- "Summarize recent developments in AI regulation"

**Economics & Markets:**
- "What are current inflation trends in major economies?"
- "Analyze the impact of interest rate changes on housing markets"

**Patents & Innovation:**
- "Find recent patents related to renewable energy storage"
- "What are emerging trends in AI-related patent filings?"

**Healthcare & Pharmaceuticals:**
- "What are the contraindications for warfarin?"
- "Research Moderna's drug pipeline and recent clinical trial results"

**Cross-Domain Analysis:**
- "How do recent AI breakthroughs relate to patent filings and market valuations?"
- "Analyze the economic impact of pharmaceutical innovations in cancer treatment"

**With Local Models (Ollama):**
- Run unlimited queries without API costs
- Keep all your research completely private
- Perfect for sensitive data and proprietary research

## 🏗️ Architecture

- **Frontend**: Next.js 15 with App Router, Tailwind CSS, shadcn/ui
- **AI**: OpenAI GPT-4 with function calling + Ollama for local models
- **Data**: Valyu API for comprehensive data across all domains
- **Code Execution**: Daytona sandboxes for secure Python execution
- **Visualizations**: Recharts for interactive charts
- **Real-time**: Streaming responses with Vercel AI SDK
- **Local Models**: Ollama integration for private, unlimited queries

## 🔒 Security

- Secure API key management
- Sandboxed code execution via Daytona
- No storage of sensitive data
- HTTPS encryption for all API calls
- Privacy-first design with optional local model support

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgments

- Built with [Valyu](https://platform.valyu.network) - The unified knowledge API
- Powered by [Daytona](https://daytona.io) - Secure code execution
- UI components from [shadcn/ui](https://ui.shadcn.com)

---

<p align="center">
  Made with ❤️ by the Valyu team
</p>

<p align="center">
  <a href="https://twitter.com/ValyuNetwork">Twitter</a> •
  <a href="https://www.linkedin.com/company/valyu-network">LinkedIn</a> •
  <a href="https://github.com/yorkeccak/bio">GitHub</a>
</p>
