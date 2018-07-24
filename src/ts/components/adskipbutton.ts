import {ButtonConfig, Button} from './button';
import {UIInstanceManager} from '../uimanager';
import SkipMessage = bitmovin.PlayerAPI.SkipMessage;
import {StringUtils} from '../stringutils';

/**
 * Configuration interface for the {@link AdSkipButton}.
 */
export interface AdSkipButtonConfig extends ButtonConfig {
  skipMessage?: SkipMessage;
}

/**
 * A button that is displayed during ads and can be used to skip the ad.
 */
export class AdSkipButton extends Button<AdSkipButtonConfig> {

  constructor(config: AdSkipButtonConfig = {}) {
    super(config);

    this.config = this.mergeConfig(config, <AdSkipButtonConfig>{
      cssClass: 'ui-button-ad-skip',
      skipMessage: {
        countdown: 'Skip ad in {remainingTime}',
        skip: 'Skip ad',
      },
    }, this.config);
  }

  configure(player: bitmovin.PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);

    let config = <AdSkipButtonConfig>this.getConfig(); // TODO get rid of generic cast
    let skipMessage = config.skipMessage;
    let adEvent = <bitmovin.PlayerAPI.AdStartedEvent>null;

    let updateSkipMessageHandler = () => {
      // Display this button only if ad is skippable
      if (adEvent.skipOffset) {
        this.show();
      } else {
        this.hide();
      }

      // Update the skip message on the button
      if (player.getCurrentTime() < adEvent.skipOffset) {
        this.setText(
          StringUtils.replaceAdMessagePlaceholders(config.skipMessage.countdown, adEvent.skipOffset, player));
      } else {
        this.setText(config.skipMessage.skip);
      }
    };

    let adStartHandler = (event: bitmovin.PlayerAPI.AdStartedEvent) => {
      adEvent = event;
      skipMessage = adEvent.skipMessage || skipMessage;
      updateSkipMessageHandler();

      player.addEventHandler(player.Event.TimeChanged, updateSkipMessageHandler);
    };

    let adEndHandler = () => {
      player.removeEventHandler(player.Event.TimeChanged, updateSkipMessageHandler);
    };

    player.addEventHandler(player.Event.AdStarted, adStartHandler);
    player.addEventHandler(player.Event.AdSkipped, adEndHandler);
    player.addEventHandler(player.Event.AdError, adEndHandler);
    player.addEventHandler(player.Event.AdFinished, adEndHandler);

    this.onClick.subscribe(() => {
      // Try to skip the ad (this only works if it is skippable so we don't need to take extra care of that here)
      player.skipAd();
    });
  }
}