# Cloud Accounts - Atualizacao

Saiu uma atualizacao grande no **Cloud Accounts**, focada em fluxo multi-conta, interface mais limpa e gerenciamento de sessao muito melhor.

```txt
Resumo rapido:
+ menos relogin
+ menos polling inutil
+ mais troca automatica
+ interface mais clean
+ mais privacidade em prints
```

## [ - ] O que entrou nessa atualizacao

```diff
+ refresh automatico de tokens para reduzir relogin forcado
+ rotacao mais inteligente de contas baseada no uso restante
+ cooldown para contas esgotadas, evitando rechecks desnecessarios
+ dock oculta no topo para troca rapida de contas
+ interface refeita com visual mais clean e minimalista
+ novo onboarding em 4 etapas
+ personalizacao de tema com accent color
+ modo de privacidade para esconder e-mails em prints e gravacoes
+ emojis de status das contas com Fluent Emoji
+ melhorias no grafico, responsividade e controle de overflow
```

## [ - ] O que saiu / mudou do fluxo antigo

```diff
- dependencia de relogar toda hora quando o token expirava
- rechecks agressivos em contas esgotadas
- troca de conta mais manual e mais lenta
- topbar/sidebar mais pesada e menos discreta
- visual inconsistente entre botoes, destaques e graficos
- exposicao direta de e-mails em prints sem modo de privacidade
```

```txt
Exemplo pratico:
se a conta A acabar ou ficar quase esgotada,
o app pode priorizar outra conta com mais limite restante.
```

## [ - ] Tecnologias usadas / novas no projeto

- `Electron 37`
- `React 19`
- `Vite 7`
- `Tailwind CSS 4`
- `Framer Motion`
- `Recharts`
- `Fluent Emoji`

## [ - ] Repo

```txt
https://github.com/AnThophicous/cloud-accounts
```

## [ - ] Aviso

Se voces forem gravar, mostrar ou tirar print do app, agora ja existe modo de privacidade para esconder os e-mails das contas na interface.
