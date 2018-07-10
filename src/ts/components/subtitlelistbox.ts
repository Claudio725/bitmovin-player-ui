import {ListBox} from './listbox';
import {ListSelectorConfig} from './listselector';
import {UIInstanceManager} from '../uimanager';
import {SubtitleSwitchHandler} from '../subtitleutils';

/**
 * A element that is similar to a select box where the user can select a subtitle
 */
export class SubtitleListBox extends ListBox {
  constructor(config: ListSelectorConfig = {}) {
    super(config);
    this.config = this.mergeConfig(config, {
      cssClass: 'ui-subtitles-listbox',
    }, this.config);
  }

  configure(player: bitmovin.PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);

    new SubtitleSwitchHandler(player, this);
  }
}
