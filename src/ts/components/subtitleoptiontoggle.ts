import {ToggleButton, ToggleButtonConfig} from './togglebutton';
import {UIInstanceManager} from '../uimanager';
import {DOM} from '../dom';

/**
 * A button that toggles the option menu for subtitles
 */
export class SubtitleOptionsToggle extends ToggleButton<ToggleButtonConfig> {

  constructor(config: ToggleButtonConfig = {}) {
    super(config);

    this.config = this.mergeConfig(config, {
      cssClass: 'ui-subtitleoptiontoggle',
      text: 'Subtitles settings',
    }, this.config);
  }

  configure(player: bitmovin.PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);

    let config = <ToggleButtonConfig>this.getConfig();

    let checkVisibility = () => {
      // Only display the menu panel if subtitles are present
      if (player.getAvailableSubtitles().length === 1) {
        this.hide();
      } else {
        this.show();
      }
    }

    // If the source change, we might not have subtitles and won't need the option
    player.addEventHandler(player.EVENT.ON_SUBTITLE_ADDED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_SUBTITLE_CHANGED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_SUBTITLE_REMOVED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_SOURCE_UNLOADED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_READY, checkVisibility);

    checkVisibility()
  }

  protected toDomElement(): DOM {
    // Create the button element with the text label
    let buttonElement = new DOM('button', {
      'type': 'button',
      'id': this.config.id,
      'class': this.getCssClasses()
    }).append(new DOM('span', {}).html(this.config.text));

    // Listen for the click event on the button element and trigger the corresponding event on the button component
    buttonElement.on('click', () => {
      this.onClickEvent();
    });

    return buttonElement;
  }
}

/**
 * A button that toggles the option menu for subtitles
 */
export class SubtitlePanelCloser extends ToggleButton<ToggleButtonConfig> {

  constructor(config: ToggleButtonConfig = {}) {
    super(config);

    this.config = this.mergeConfig(config, {
      cssClass: 'ui-subtitleoptiontoggle',
      cssClasses: ['ui-subtitleoptioncloser'],
      text: 'Normal settings',
    }, this.config);
  }

  configure(player: bitmovin.PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);

    let config = <ToggleButtonConfig>this.getConfig();

    let checkVisibility = () => {
      // Only display the menu panel if subtitles are present
      if (player.getAvailableSubtitles().length === 1) {
        this.hide();
      } else {
        this.show();
      }
    }

    // If the source change, we might not have subtitles and won't need the option
    player.addEventHandler(player.EVENT.ON_SUBTITLE_ADDED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_SUBTITLE_CHANGED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_SUBTITLE_REMOVED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_SOURCE_UNLOADED, checkVisibility);
    player.addEventHandler(player.EVENT.ON_READY, checkVisibility);

    checkVisibility()
  }

  protected toDomElement(): DOM {
    // Create the button element with the text label
    let buttonElement = new DOM('button', {
      'type': 'button',
      'id': this.config.id,
      'class': this.getCssClasses()
    }).append(new DOM('span', {}).html(this.config.text));

    // Listen for the click event on the button element and trigger the corresponding event on the button component
    buttonElement.on('click', () => {
      this.onClickEvent();
    });

    return buttonElement;
  }
}
