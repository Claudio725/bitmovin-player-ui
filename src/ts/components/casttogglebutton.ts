import {ToggleButton, ToggleButtonConfig} from './togglebutton';
import {UIInstanceManager} from '../uimanager';

/**
 * A button that toggles casting to a Cast receiver.
 */
export class CastToggleButton extends ToggleButton<ToggleButtonConfig> {

  constructor(config: ToggleButtonConfig = {}) {
    super(config);

    this.config = this.mergeConfig(config, {
      cssClass: 'ui-casttogglebutton',
      text: 'Google Cast',
    }, this.config);
  }

  configure(player: bitmovin.PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);

    this.onClick.subscribe(() => {
      if (player.isCastAvailable()) {
        if (player.isCasting()) {
          player.castStop();
        } else {
          player.castVideo();
        }
      } else {
        if (console) {
          console.log('Cast unavailable');
        }
      }
    });

    let castAvailableHander = () => {
      if (player.isCastAvailable()) {
        this.show();
      } else {
        this.hide();
      }
    };

    player.on(player.Event.CastAvailable, castAvailableHander);

    // Toggle button 'on' state
    player.on(player.Event.CastWaitingForDevice, () => {
      this.on();
    });
    player.on(player.Event.CastStarted, () => {
      // When a session is resumed, there is no CastStart event, so we also need to toggle here for such cases
      this.on();
    });
    player.on(player.Event.CastStopped, () => {
      this.off();
    });

    // Startup init
    castAvailableHander(); // Hide button if Cast not available
    if (player.isCasting()) {
      this.on();
    }
  }
}