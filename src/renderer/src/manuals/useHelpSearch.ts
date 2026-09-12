import { useEffect } from 'react'

export function useHelpSearch(): void {
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('#search')!
    const clear = document.querySelector<HTMLButtonElement>('#clear')!
    const articles = [...document.querySelectorAll('article')]
    const links = [...document.querySelectorAll<HTMLAnchorElement>('nav a')]
    const empty = document.querySelector<HTMLElement>('#empty')!
    const normalize = (value: string): string => value.toLocaleLowerCase().replace(/\s+/g, '')
    const search = (): void => {
      const keyword = normalize(input.value)
      for (const article of articles) {
        article.hidden = Boolean(
          keyword &&
          !normalize(`${article.dataset.title || ''}${article.textContent}`).includes(keyword)
        )
      }
      for (const link of links) {
        const target = document.getElementById(link.hash.slice(1))
        link.hidden = Boolean(keyword && target?.hidden)
      }
      empty.style.display = articles.some((article) => !article.hidden) ? 'none' : 'block'
    }
    const reset = (): void => {
      input.value = ''
      search()
      input.focus()
    }
    const highlight = (): void => {
      for (const link of links) link.classList.toggle('active', link.hash === location.hash)
    }
    input.addEventListener('input', search)
    clear.addEventListener('click', reset)
    window.addEventListener('hashchange', highlight)
    highlight()
    return () => {
      input.removeEventListener('input', search)
      clear.removeEventListener('click', reset)
      window.removeEventListener('hashchange', highlight)
    }
  }, [])
}
