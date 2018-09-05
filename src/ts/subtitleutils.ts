import {ListSelector, ListSelectorConfig} from './components/listselector';
import { InternalUIConfig, UIInstanceManager, UIManager } from './uimanager';

/**
 * Helper class to handle all subtitle related events
 *
 * This class listens to player events as well as the `ListSelector` event if selection changed
 */
export class SubtitleSwitchHandler {

  private player: bitmovin.PlayerAPI;
  private listElement: ListSelector<ListSelectorConfig>;
  private uimanager: UIInstanceManager;

  constructor(player: bitmovin.PlayerAPI, element: ListSelector<ListSelectorConfig>, uimanager: UIInstanceManager) {
    this.player = player;
    this.listElement = element;
    this.uimanager = uimanager;

    this.bindSelectionEvent();
    this.bindPlayerEvents();
    this.updateSubtitles();
  }

  private bindSelectionEvent(): void {
    this.listElement.onItemSelected.subscribe((_, value: string) => {
      // TODO add support for multiple concurrent subtitle selections
      if (value === 'null') {
        const currentSubtitle = this.player.subtitles.list().filter((subtitle) => subtitle.enabled).pop();
        this.player.subtitles.disable(currentSubtitle.id);
      } else {
        this.player.subtitles.enable(value, true);
      }
    });
  }

  private bindPlayerEvents(): void {
    const updateSubtitlesCallback = (): void => this.updateSubtitles();

    this.player.on(this.player.exports.Event.SubtitleAdded, updateSubtitlesCallback);
    this.player.on(this.player.exports.Event.SubtitleEnabled, () => {
      this.selectCurrentSubtitle();
    });
    this.player.on(this.player.exports.Event.SubtitleDisabled, () => {
      this.selectCurrentSubtitle();
    });
    this.player.on(this.player.exports.Event.SubtitleRemoved, updateSubtitlesCallback);
    // Update subtitles when source goes away
    this.player.on(this.player.exports.Event.SourceUnloaded, updateSubtitlesCallback);
    // Update subtitles when the period within a source changes
    this.player.on(this.player.exports.Event.PeriodSwitched, updateSubtitlesCallback);
    // Listen to the UI event when components need to update them-self
    // Will also be triggered on player.exports.Event.SourceLoaded
    this.uimanager.getConfig().events.onUpdated.subscribe(updateSubtitlesCallback);
  }

  private updateSubtitles(): void {
    this.listElement.clearItems();

    if (!this.player.subtitles) {
      // Subtitles API not available (yet)
      return;
    }

    this.listElement.addItem('null', 'off');

    for (let subtitle of this.player.subtitles.list()) {
      this.listElement.addItem(subtitle.id, subtitle.label);
    }

    // Select the correct subtitle after the subtitles have been added
    this.selectCurrentSubtitle();
  }

  private selectCurrentSubtitle() {
    let currentSubtitle = this.player.subtitles.list().filter((subtitle) => subtitle.enabled).pop();

    if (currentSubtitle) {
      this.listElement.selectItem(currentSubtitle.id);
    }
  }
}
