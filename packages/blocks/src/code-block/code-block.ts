import '../__internal__/rich-text/rich-text.js';
import './components/code-option.js';
import './components/lang-list.js';

import { assertExists } from '@blocksuite/global/utils';
import { BlockElement } from '@blocksuite/lit';
import { flip, offset, shift, size } from '@floating-ui/dom';
import { css, html, nothing, render } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import {
  getHighlighter,
  type Highlighter,
  type ILanguageRegistration,
  type Lang,
} from 'shiki';
import { z } from 'zod';

import { PAGE_HEADER_HEIGHT } from '../__internal__/consts.js';
import { queryCurrentMode } from '../__internal__/index.js';
import { bindContainerHotkey } from '../__internal__/rich-text/keymap/index.js';
import type { AffineTextSchema } from '../__internal__/rich-text/virgo/types.js';
import { getService } from '../__internal__/service/index.js';
import { listenToThemeChange } from '../__internal__/theme/utils.js';
import { createLitPortal } from '../components/portal.js';
import { tooltipStyle } from '../components/tooltip/tooltip.js';
import { ArrowDownIcon } from '../icons/index.js';
import type { CodeBlockModel } from './code-model.js';
import { CodeOptionTemplate } from './components/code-option.js';
import { LangList } from './components/lang-list.js';
import { getStandardLanguage } from './utils/code-languages.js';
import { getCodeLineRenderer } from './utils/code-line-renderer.js';
import {
  DARK_THEME,
  LIGHT_THEME,
  PLAIN_TEXT_REGISTRATION,
} from './utils/consts.js';

@customElement('affine-code')
export class CodeBlockComponent extends BlockElement<CodeBlockModel> {
  static override styles = css`
    code-block {
      position: relative;
      z-index: 1;
    }

    .affine-code-block-container {
      font-size: var(--affine-font-sm);
      line-height: var(--affine-line-height);
      position: relative;
      padding: 32px 0px 12px 0px;
      background: var(--affine-background-code-block);
      border-radius: 10px;
      margin-top: 24px;
      margin-bottom: 24px;
    }

    /* hover area */
    .affine-code-block-container::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: 50px;
      height: 100%;
      transform: translateX(100%);
    }

    /* hover area */
    .affine-code-block-container::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: 50px;
      height: 100%;
      transform: translateX(100%);
    }

    .affine-code-block-container .virgo-editor {
      font-family: var(--affine-font-code-family);
      font-variant-ligatures: none;
    }

    .affine-code-block-container .lang-list-wrapper {
      position: absolute;
      font-size: var(--affine-font-sm);
      line-height: var(--affine-line-height);
      top: 12px;
      left: 12px;
    }

    .affine-code-block-container > .lang-list-wrapper {
      visibility: hidden;
    }
    .affine-code-block-container:hover > .lang-list-wrapper {
      visibility: visible;
    }

    .affine-code-block-container > .lang-list-wrapper > .lang-button {
      display: flex;
      justify-content: flex-start;
      padding: 0 8px;
    }

    .affine-code-block-container rich-text {
      /* to make sure the resize observer can be triggered as expected */
      display: block;
      position: relative;
      width: 90%;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 20px;
    }

    .affine-code-block-container .rich-text-container {
      position: relative;
      border-radius: 4px;
      padding: 4px 12px 4px 60px;
    }

    #line-numbers {
      position: absolute;
      text-align: right;
      left: 20px;
      line-height: var(--affine-line-height);
      color: var(--affine-text-secondary-color);
    }

    .affine-code-block-container .virgo-editor {
      width: 90%;
      margin: 0;
    }

    .affine-code-block-container affine-code-line span v-text {
      display: inline;
    }

    .affine-code-block-container affine-code-line span {
      white-space: pre;
    }

    .affine-code-block-container.wrap #line-numbers {
      top: calc(var(--affine-line-height) + 4px);
    }

    .affine-code-block-container.wrap #line-numbers > div {
      margin-top: calc(
        var(--top, 0) / var(--affine-zoom, 1) - var(--affine-line-height)
      );
    }

    .affine-code-block-container.wrap v-line > div {
      display: block;
    }

    .affine-code-block-container.wrap affine-code-line span {
      white-space: break-spaces;
    }

    .affine-code-block-container .virgo-editor::-webkit-scrollbar {
      display: none;
    }

    .code-block-option {
      box-shadow: var(--affine-shadow-2);
      border-radius: 8px;
      list-style: none;
      padding: 4px;
      width: 40px;
      background-color: var(--affine-background-overlay-panel-color);
      margin: 0;
    }

    ${tooltipStyle}
  `;

  @state()
  private _wrap = false;

  @query('.lang-button')
  private _langButton!: HTMLButtonElement;

  private _optionsPortal: HTMLDivElement | null = null;

  @state()
  private _langListAbortController?: AbortController;

  private get _showLangList() {
    return !!this._langListAbortController;
  }

  get readonly() {
    return this.model.page.readonly;
  }

  readonly textSchema: AffineTextSchema = {
    attributesSchema: z.object({}),
    textRenderer: () =>
      getCodeLineRenderer(() => ({
        lang: this.model.language.toLowerCase() as Lang,
        highlighter: this._highlighter,
      })),
  };

  private _richTextResizeObserver: ResizeObserver = new ResizeObserver(() => {
    this._updateLineNumbers();
  });

  private _perviousLanguage: ILanguageRegistration = PLAIN_TEXT_REGISTRATION;
  private _highlighter: Highlighter | null = null;
  private async _startHighlight(lang: ILanguageRegistration) {
    if (this._highlighter) {
      const loadedLangs = this._highlighter.getLoadedLanguages();
      if (!loadedLangs.includes(lang.id as Lang)) {
        this._highlighter.loadLanguage(lang).then(() => {
          const richText = this.querySelector('rich-text');
          const vEditor = richText?.vEditor;
          if (vEditor) {
            vEditor.requestUpdate();
          }
        });
      }
      return;
    }
    const mode = queryCurrentMode();
    this._highlighter = await getHighlighter({
      theme: mode === 'dark' ? DARK_THEME : LIGHT_THEME,
      themes: [LIGHT_THEME, DARK_THEME],
      langs: [lang],
      paths: {
        // TODO: use local path
        wasm: 'https://cdn.jsdelivr.net/npm/shiki/dist',
        themes: 'https://cdn.jsdelivr.net/',
        languages: 'https://cdn.jsdelivr.net/npm/shiki/languages',
      },
    });

    const richText = this.querySelector('rich-text');
    assertExists(richText);
    const vEditor = richText.vEditor;
    assertExists(vEditor);
    const range = vEditor.getVRange();
    vEditor.requestUpdate();
    if (range) {
      vEditor.setVRange(range);
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    // set highlight options getter used by "exportToHtml"
    getService('affine:code').setHighlightOptionsGetter(() => {
      return {
        lang: this._perviousLanguage.id as Lang,
        highlighter: this._highlighter,
      };
    });
    this._disposables.add(
      this.model.propsUpdated.on(() => this.requestUpdate())
    );
    this._disposables.add(
      this.model.childrenUpdated.on(() => this.requestUpdate())
    );

    this._disposables.add(
      listenToThemeChange(this, async () => {
        if (!this._highlighter) return;
        const richText = this.querySelector('rich-text');
        const vEditor = richText?.vEditor;
        if (!vEditor) return;

        // update code-line theme
        setTimeout(() => {
          vEditor.requestUpdate();
        });
      })
    );

    this._observePosition();
    bindContainerHotkey(this);

    const selection = this.root.selectionManager;
    this.bindHotKey({
      Backspace: () => {
        if (!selection.find('text')) return;

        selection.update(selList => {
          return selList
            .filter(sel => !sel.is('text'))
            .concat(selection.getInstance('block', { path: this.path }));
        });
        return true;
      },
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._richTextResizeObserver.disconnect();
  }

  override updated() {
    if (this.model.language !== this._perviousLanguage.id) {
      const lang = getStandardLanguage(this.model.language);
      this._perviousLanguage = lang ?? PLAIN_TEXT_REGISTRATION;
      if (lang) {
        this._startHighlight(lang);
      } else {
        this._highlighter = null;
      }

      const richText = this.querySelector('rich-text');
      const vEditor = richText?.vEditor;
      if (vEditor) {
        vEditor.requestUpdate();
      }
    }

    const richText = this.querySelector('rich-text');
    assertExists(richText);
    this._richTextResizeObserver.disconnect();
    this._richTextResizeObserver.observe(richText);
  }

  private _onClickWrapBtn() {
    const container = this.querySelector('.affine-code-block-container');
    assertExists(container);
    this._wrap = container.classList.toggle('wrap');
  }

  private _observePosition() {
    this._disposables.addFromEvent(this, 'mouseenter', () => {
      if (this._optionsPortal?.isConnected) return;
      const abortController = new AbortController();

      this._optionsPortal = createLitPortal({
        template: ({ updatePortal }) =>
          CodeOptionTemplate({
            anchor: this,
            model: this.model,
            wrap: this._wrap,
            onClickWrap: () => {
              this._onClickWrapBtn();
              updatePortal();
            },
            abortController,
          }),
        computePosition: {
          referenceElement: this,
          placement: 'right-start',
          middleware: [
            offset({
              mainAxis: 12,
              crossAxis: 10,
            }),
            shift({
              crossAxis: true,
              padding: {
                top: PAGE_HEADER_HEIGHT + 12,
                bottom: 12,
                right: 12,
              },
            }),
          ],
          autoUpdate: true,
        },
        abortController,
      });
    });
  }

  private _onClickLangBtn() {
    if (this.readonly) return;
    if (this._langListAbortController) return;
    const abortController = new AbortController();
    this._langListAbortController = abortController;
    abortController.signal.addEventListener('abort', () => {
      this._langListAbortController = undefined;
    });

    createLitPortal({
      template: ({ positionSlot }) => {
        const langList = new LangList();
        langList.currentLanguageId = this._perviousLanguage.id as Lang;
        langList.onSelectLanguage = (lang: ILanguageRegistration | null) => {
          getService('affine:code').setLang(this.model, lang ? lang.id : null);
          abortController.abort();
        };
        langList.onClose = () => abortController.abort();
        positionSlot.on(({ placement }) => {
          langList.placement = placement;
        });
        return langList;
      },
      computePosition: {
        referenceElement: this._langButton,
        placement: 'bottom-start',
        middleware: [
          offset(4),
          flip(),
          size({
            padding: 12,
            apply({ availableHeight, elements }) {
              Object.assign(elements.floating.style, {
                height: '100%',
                maxHeight: `${availableHeight}px`,
              });
            },
          }),
        ],
        autoUpdate: true,
      },
      abortController,
    });
  }

  private _curLanguageButtonTemplate() {
    const curLanguage =
      getStandardLanguage(this.model.language) ?? PLAIN_TEXT_REGISTRATION;
    const curLanguageDisplayName = curLanguage.displayName ?? curLanguage.id;
    return html`<div
      class="lang-list-wrapper"
      style="${this._showLangList ? 'visibility: visible;' : ''}"
    >
      <icon-button
        class="lang-button"
        data-testid="lang-button"
        width="auto"
        height="24px"
        ?hover=${this._showLangList}
        ?disabled=${this.readonly}
        @click=${this._onClickLangBtn}
      >
        ${curLanguageDisplayName} ${!this.readonly ? ArrowDownIcon : nothing}
      </icon-button>
    </div>`;
  }

  private _updateLineNumbers() {
    const lineNumbersContainer =
      this.querySelector<HTMLElement>('#line-numbers');
    assertExists(lineNumbersContainer);

    const next = this._wrap ? generateLineNumberRender() : lineNumberRender;

    render(
      repeat(Array.from(this.querySelectorAll('v-line')), next),
      lineNumbersContainer
    );
  }

  override render() {
    return html`<div class="affine-code-block-container">
      ${this._curLanguageButtonTemplate()}
      <div class="rich-text-container">
        <div id="line-numbers"></div>
        <rich-text .model=${this.model} .textSchema=${this.textSchema}>
        </rich-text>
      </div>
      ${this.content}
      ${this.selected?.is('block')
        ? html`<affine-block-selection></affine-block-selection>`
        : null}
    </div>`;
  }
}

function generateLineNumberRender(top = 0) {
  return function lineNumberRender(e: HTMLElement, index: number) {
    const style = {
      '--top': `${top}px`,
    };
    top = e.getBoundingClientRect().height;
    return html`<div style=${styleMap(style)}>${index + 1}</div>`;
  };
}

function lineNumberRender(_: HTMLElement, index: number) {
  return html`<div>${index + 1}</div>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-code': CodeBlockComponent;
  }
}
