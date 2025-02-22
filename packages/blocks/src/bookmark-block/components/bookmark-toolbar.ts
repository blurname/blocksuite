import { createDelayHoverSignal } from '@blocksuite/global/utils';
import { WithDisposable } from '@blocksuite/lit';
import { type BaseBlockModel } from '@blocksuite/store';
import { flip, offset } from '@floating-ui/dom';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import * as Y from 'yjs';

import { createLitPortal } from '../../components/portal.js';
import { tooltipStyle } from '../../components/tooltip/tooltip.js';
import {
  CaptionIcon,
  EditIcon,
  LinkIcon,
  MoreIcon,
} from '../../icons/index.js';
import type { BookmarkBlockModel } from '../bookmark-model.js';
import {
  BookmarkOperationMenu,
  type MenuActionCallback,
} from './bookmark-operation-popper.js';

export type ConfigItem = {
  type: 'link' | 'edit' | 'caption';
  icon: TemplateResult;
  tooltip: string;
  action: (
    model: BaseBlockModel<BookmarkBlockModel>,
    callback?: ToolbarActionCallback,
    element?: HTMLElement
  ) => void;
  divider?: boolean;
};

export type ToolbarActionCallback = (type: ConfigItem['type']) => void;
const config: ConfigItem[] = [
  {
    type: 'link',
    icon: LinkIcon,
    tooltip: 'Turn into Link view',
    action: (model, callback) => {
      const { page } = model;

      const parent = page.getParent(model);
      const index = parent?.children.indexOf(model);

      const yText = new Y.Text();
      const insert = model.bookmarkTitle || model.caption || model.url;
      yText.insert(0, insert);
      yText.format(0, insert.length, { link: model.url });
      const text = new page.Text(yText);
      page.addBlock(
        'affine:paragraph',
        {
          text,
        },
        parent,
        index
      );

      model.page.deleteBlock(model);
      callback?.('link');
    },
    divider: true,
  },
  {
    type: 'edit',
    icon: EditIcon,
    tooltip: 'Edit',
    action: (_model, callback) => {
      callback?.('edit');
    },
  },
  {
    type: 'caption',
    icon: CaptionIcon,
    tooltip: 'Add Caption',
    action: (_model, callback) => {
      callback?.('caption');
    },
    divider: true,
  },
];

@customElement('bookmark-toolbar')
export class BookmarkToolbar extends WithDisposable(LitElement) {
  static override styles = css`
    ${tooltipStyle}
    .bookmark-bar {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      padding: 4px 8px;
      gap: 4px;
      height: 40px;

      border-radius: 8px;
      background: var(--affine-background-overlay-panel-color);
      box-shadow: var(--affine-shadow-2);
      z-index: var(--affine-z-index-popover);
      user-select: none;
    }
    .divider {
      width: 1px;
      height: 24px;
      background-color: var(--affine-border-color);
    }
  `;

  @property({ attribute: false })
  model!: BaseBlockModel;

  @property({ attribute: false })
  onSelected?: ToolbarActionCallback & MenuActionCallback;

  @property({ attribute: false })
  root!: HTMLElement;

  @property({ attribute: false })
  abortController!: AbortController;

  @query('.bookmark-bar')
  bookmarkBarElement!: HTMLElement;

  @query('.more-button-wrapper')
  moreButton!: HTMLElement;

  override connectedCallback() {
    super.connectedCallback();
    const { onHover, onHoverLeave } = createDelayHoverSignal(
      this.abortController
    );
    this.disposables.addFromEvent(this, 'mouseover', onHover);
    this.disposables.addFromEvent(this, 'mouseleave', onHoverLeave);
    this.disposables.addFromEvent(this.root, 'mouseover', onHover);
    this.disposables.addFromEvent(this.root, 'mouseleave', onHoverLeave);
  }

  private _moreMenuAbortController: AbortController | null = null;

  private _toggleMenu() {
    if (this._moreMenuAbortController) {
      this._moreMenuAbortController.abort();
      this._moreMenuAbortController = null;
      return;
    }
    this._moreMenuAbortController = new AbortController();
    const bookmarkOperationMenu = new BookmarkOperationMenu();
    bookmarkOperationMenu.model = this.model;
    bookmarkOperationMenu.onSelected = this.onSelected;

    createLitPortal({
      template: bookmarkOperationMenu,
      container: this.bookmarkBarElement,
      computePosition: {
        referenceElement: this.bookmarkBarElement,
        placement: 'top-end',
        middleware: [flip(), offset(4)],
      },
      abortController: this._moreMenuAbortController,
    });
  }

  override render() {
    const buttons = repeat(
      config,
      ({ type }) => type,
      ({ type, icon, tooltip, action, divider }) => {
        return html`<icon-button
            size="24px"
            class="bookmark-toolbar-button has-tool-tip ${type}"
            @click=${() => {
              action(this.model, this.onSelected, this);
            }}
          >
            ${icon}
            <tool-tip inert role="tooltip">${tooltip}</tool-tip>
          </icon-button>
          ${divider ? html`<div class="divider"></div>` : nothing} `;
      }
    );

    return html`
      <div class="bookmark-bar">
        ${buttons}

        <div class="more-button-wrapper">
          <icon-button
            width="32px"
            height="32px"
            class="has-tool-tip more-button"
            @click=${() => {
              this._toggleMenu();
            }}
          >
            ${MoreIcon}
            <tool-tip inert role="tooltip">More</tool-tip>
          </icon-button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bookmark-toolbar': BookmarkToolbar;
  }
}
