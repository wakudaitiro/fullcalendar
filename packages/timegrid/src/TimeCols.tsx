import {
  h, VNode, Ref,
  removeElement,
  applyStyle,
  PositionCache,
  Duration,
  createDuration,
  addDurations,
  multiplyDuration,
  wholeDivideDurations,
  asRoughMs,
  startOfDay,
  DateMarker,
  ComponentContext,
  BaseComponent,
  Seg,
  EventSegUiInteractionState,
  DateProfile,
  sortEventSegs,
  memoize,
  subrenderer,
  setRef,
  CssDimValue
} from '@fullcalendar/core'
import { DayBgRow, DayBgCellModel } from '@fullcalendar/daygrid'
import TimeColsEvents from './TimeColsEvents'
import TimeColsMirrorEvents from './TimeColsMirrorEvents'
import TimeColsFills from './TimeColsFills'
import TimeColsSlats from './TimeColsSlats'
import TimeColsContentSkeleton, { TimeColsContentSkeletonContainers } from './TimeColsContentSkeleton'
import { __assign } from 'tslib'


export interface TimeColsSeg extends Seg {
  col: number
  start: DateMarker
  end: DateMarker
}

export interface TimeColsProps {
  dateProfile: DateProfile
  cells: DayBgCellModel[]
  businessHourSegs: TimeColsSeg[]
  bgEventSegs: TimeColsSeg[]
  fgEventSegs: TimeColsSeg[]
  dateSelectionSegs: TimeColsSeg[]
  eventSelection: string
  eventDrag: EventSegUiInteractionState | null
  eventResize: EventSegUiInteractionState | null
  rootElRef?: Ref<HTMLDivElement>
  tableColGroupNode: VNode
  tableWidth: CssDimValue
  tableHeight: CssDimValue
  renderBgIntro: () => VNode[]
  renderIntro: () => VNode[]
  nowIndicatorDate: DateMarker
  nowIndicatorSegs: TimeColsSeg[]
  forPrint: boolean
  allowSizing: boolean
}

export const TIME_COLS_NOW_INDICATOR_UNIT = 'minute'


/* A component that renders one or more columns of vertical time slots
----------------------------------------------------------------------------------------------------------------------*/

export default class TimeCols extends BaseComponent<TimeColsProps> {

  private processOptions = memoize(this._processOptions)
  private renderMirrorEvents = subrenderer(TimeColsMirrorEvents)
  private renderFgEvents = subrenderer(TimeColsEvents)
  private renderBgEvents = subrenderer(TimeColsFills)
  private renderBusinessHours = subrenderer(TimeColsFills)
  private renderDateSelection = subrenderer(TimeColsFills)
  private renderNowIndicator = subrenderer(this._renderNowIndicator, this._unrenderNowIndicator)

  // computed options
  private slotDuration: Duration // duration of a "slot", a distinct time segment on given day, visualized by lines
  private snapDuration: Duration // granularity of time for dragging and selecting
  private snapsPerSlot: any

  private rootEl: HTMLElement
  private colContainerEls: HTMLElement[] // containers for each column
  private businessContainerEls: HTMLElement[]
  private highlightContainerEls: HTMLElement[]
  private bgContainerEls: HTMLElement[]
  private fgContainerEls: HTMLElement[]
  private mirrorContainerEls: HTMLElement[]
  public colEls: HTMLElement[] // cells elements in the day-row background
  private slatRootEl: HTMLElement // div that wraps all the slat rows
  private slatEls: HTMLElement[] // elements running horizontally across all columns

  private colPositions: PositionCache
  private slatPositions: PositionCache
  private segRenderers: (TimeColsEvents | TimeColsFills | null)[]


  /* Rendering
  ------------------------------------------------------------------------------------------------------------------*/


  render(props: TimeColsProps, state: {}, context: ComponentContext) {
    let { theme } = context

    this.processOptions(context.options)

    return (
      <div class='fc-time-grid' ref={this.handleRootEl}>
        <div class='fc-bg'>
          <table class={theme.getClass('table')}>
            {props.tableColGroupNode}
            <DayBgRow
              dateProfile={props.dateProfile}
              cells={props.cells}
              renderIntro={props.renderBgIntro}
              onReceiveCellEls={this.handleBgCellEls}
            />
          </table>
        </div>
        <div class='fc-slats'>
          <table
            class={theme.getClass('table') + ' vgrow' /* why not use rowsGrow like resource view? */}
            style={{
              // TODO: add minWidth
              width: props.tableWidth,
              height: props.tableHeight
            }}
          >
            {props.tableColGroupNode /* relies on there only being a single <col> for the axis */}
            <TimeColsSlats
              dateProfile={props.dateProfile}
              slotDuration={this.slotDuration}
              onReceiveSlatEls={this.handleSlatEls}
            />
          </table>
        </div>
        <div class='fc-content-skeleton'>
          <table>
            {props.tableColGroupNode}
            <TimeColsContentSkeleton
              colCnt={props.cells.length}
              renderIntro={props.renderIntro}
              onReceiveContainerEls={this.handleContainerEls /* expensive, but TimeColsContentSkeleton rerender is rare */}
            />
          </table>
        </div>
      </div>
    )
  }


  // Parses various options into properties of this object
  // MUST have context already set
  _processOptions(options) {
    let { slotDuration, snapDuration } = options
    let snapsPerSlot

    slotDuration = createDuration(slotDuration)
    snapDuration = snapDuration ? createDuration(snapDuration) : slotDuration
    snapsPerSlot = wholeDivideDurations(slotDuration, snapDuration)

    if (snapsPerSlot === null) {
      snapDuration = slotDuration
      snapsPerSlot = 1
      // TODO: say warning?
    }

    this.slotDuration = slotDuration
    this.snapDuration = snapDuration
    this.snapsPerSlot = snapsPerSlot
  }


  handleRootEl = (rootEl: HTMLElement | null) => {
    this.rootEl = rootEl
    setRef(this.props.rootElRef, rootEl)
  }


  handleBgCellEls = (colEls: HTMLElement[] | null) => {
    if (colEls) {
      this.colEls = colEls
      this.colPositions = new PositionCache(
        colEls[0].parentNode as HTMLElement,
        colEls,
        true, // horizontal
        false
      )
    }
  }


  handleSlatEls = (slatEls: HTMLElement[] | null) => {
    if (slatEls) {
      let slatRootEl = this.slatRootEl = slatEls[0].parentNode as HTMLElement
      this.slatEls = slatEls
      this.slatPositions = new PositionCache(
        slatRootEl,
        slatEls,
        false,
        true // vertical
      )
    }
  }


  handleContainerEls = (containers: TimeColsContentSkeletonContainers | null) => {
    if (!containers) {
      this.subrenderDestroy()
    } else {
      __assign(this, containers)
    }
  }


  componentDidMount() {
    this.subrender()
    this.handleSizing()
    this.context.addResizeHandler(this.handleSizing)
  }


  componentDidUpdate() {
    this.subrender()
    this.handleSizing()
  }


  componentWillUnmount() {
    this.context.removeResizeHandler(this.handleSizing)
  }


  subrender() {
    let { props } = this
    let { options } = this.context

    this.segRenderers = [
      this.renderBusinessHours({
        type: 'businessHours',
        containerEls: this.businessContainerEls,
        segs: props.businessHourSegs,
      }),
      this.renderDateSelection({
        type: 'highlight',
        containerEls: this.highlightContainerEls,
        segs: options.selectMirror ? [] : props.dateSelectionSegs // do highlight if NO mirror
      }),
      this.renderBgEvents({
        type: 'bgEvent',
        containerEls: this.bgContainerEls,
        segs: props.bgEventSegs
      }),
      this.renderFgEvents({
        containerEls: this.fgContainerEls,
        segs: props.fgEventSegs,
        selectedInstanceId: props.eventSelection,
        hiddenInstances: // TODO: more convenient
          (props.eventDrag && props.eventDrag.segs.length ? props.eventDrag.affectedInstances : null) ||
          (props.eventResize && props.eventResize.segs.length ? props.eventResize.affectedInstances : null),
        isDragging: false,
        isResizing: false,
        isSelecting: false,
        forPrint: props.forPrint
      }),
      this.subrenderMirror(props, this.mirrorContainerEls, options)
    ]
  }


  subrenderMirror(props: TimeColsProps, mirrorContainerEls: HTMLElement[], options): TimeColsEvents | null {
    if (props.eventDrag && props.eventDrag.segs.length) { // messy check
      return this.renderMirrorEvents({
        containerEls: mirrorContainerEls,
        segs: props.eventDrag.segs,
        isDragging: true,
        isResizing: false,
        isSelecting: false,
        interactingSeg: props.eventDrag.interactingSeg,
        forPrint: props.forPrint
      })

    } else if (props.eventResize && props.eventResize.segs.length) {
      return this.renderMirrorEvents({
        containerEls: mirrorContainerEls,
        segs: props.eventResize.segs,
        isDragging: true,
        isResizing: false,
        isSelecting: false,
        interactingSeg: props.eventResize.interactingSeg,
        forPrint: props.forPrint
      })

    } else if (options.selectMirror) {
      return this.renderMirrorEvents({
        containerEls: mirrorContainerEls,
        segs: props.dateSelectionSegs,
        isDragging: false,
        isResizing: false,
        isSelecting: true,
        forPrint: props.forPrint
      })

    } else {
      return this.renderMirrorEvents(false)
    }
  }


  handleSizing = () => {
    let { segRenderers } = this

    if (this.props.allowSizing) {
      this.slatPositions.build()
      this.colPositions.build()
    } else {
      this.slatPositions.buildZeros()
      this.colPositions.buildZeros()
    }

    for (let segRenderer of segRenderers) {
      if (segRenderer) {
        segRenderer.computeSizes(true, this) // TODO: always forced!?
      }
    }

    for (let segRenderer of segRenderers) {
      if (segRenderer) {
        segRenderer.assignSizes(true, this) // TODO: always forced!?
      }
    }

    this.renderNowIndicator({ // why in sizing???
      date: this.props.nowIndicatorDate,
      segs: this.props.nowIndicatorSegs
    })
  }


  /* Now Indicator
  ------------------------------------------------------------------------------------------------------------------*/


  _renderNowIndicator({ date, segs }: { date: DateMarker, segs: TimeColsSeg[] }) {

    if (!date) {
      return []
    }

    let top = this.computeDateTop(date)
    let nodes: HTMLElement[] = []
    let i

    // render lines within the columns
    for (i = 0; i < segs.length; i++) {
      let lineEl = document.createElement('div')
      lineEl.className = 'fc-now-indicator fc-now-indicator-line'
      lineEl.style.top = top + 'px'
      this.colContainerEls[segs[i].col].appendChild(lineEl)
      nodes.push(lineEl)
    }

    // render an arrow over the axis
    if (segs.length > 0) { // is the current time in view?
      let arrowEl = document.createElement('div')
      arrowEl.className = 'fc-now-indicator fc-now-indicator-arrow'
      arrowEl.style.top = top + 'px'
      this.rootEl.appendChild(arrowEl)
      nodes.push(arrowEl)
    }

    return nodes
  }


  _unrenderNowIndicator(nodes: HTMLElement[]) {
    nodes.forEach(removeElement)
  }


  /* Coordinates
  ------------------------------------------------------------------------------------------------------------------*/


  getTotalSlatHeight() {
    return this.slatRootEl.getBoundingClientRect().height
  }


  // Computes the top coordinate, relative to the bounds of the grid, of the given date.
  // A `startOfDayDate` must be given for avoiding ambiguity over how to treat midnight.
  computeDateTop(when: DateMarker, startOfDayDate?: DateMarker) {
    if (!startOfDayDate) {
      startOfDayDate = startOfDay(when)
    }
    return this.computeTimeTop(createDuration(when.valueOf() - startOfDayDate.valueOf()))
  }


  // Computes the top coordinate, relative to the bounds of the grid, of the given time (a Duration).
  computeTimeTop(duration: Duration) {
    let len = this.slatEls.length
    let dateProfile = this.props.dateProfile
    let slatCoverage = (duration.milliseconds - asRoughMs(dateProfile.minTime)) / asRoughMs(this.slotDuration) // floating-point value of # of slots covered
    let slatIndex
    let slatRemainder

    // compute a floating-point number for how many slats should be progressed through.
    // from 0 to number of slats (inclusive)
    // constrained because minTime/maxTime might be customized.
    slatCoverage = Math.max(0, slatCoverage)
    slatCoverage = Math.min(len, slatCoverage)

    // an integer index of the furthest whole slat
    // from 0 to number slats (*exclusive*, so len-1)
    slatIndex = Math.floor(slatCoverage)
    slatIndex = Math.min(slatIndex, len - 1)

    // how much further through the slatIndex slat (from 0.0-1.0) must be covered in addition.
    // could be 1.0 if slatCoverage is covering *all* the slots
    slatRemainder = slatCoverage - slatIndex

    return this.slatPositions.tops[slatIndex] +
      this.slatPositions.getHeight(slatIndex) * slatRemainder
  }


  // For each segment in an array, computes and assigns its top and bottom properties
  computeSegVerticals(segs: Seg[]) {
    let { options } = this.context
    let eventMinHeight = options.timeGridEventMinHeight
    let i
    let seg
    let dayDate

    for (i = 0; i < segs.length; i++) {
      seg = segs[i]
      dayDate = this.props.cells[seg.col].date

      seg.top = this.computeDateTop(seg.start, dayDate)
      seg.bottom = Math.max(
        seg.top + eventMinHeight,
        this.computeDateTop(seg.end, dayDate)
      )
    }
  }


  // Given segments that already have their top/bottom properties computed, applies those values to
  // the segments' elements.
  assignSegVerticals(segs) {
    let i
    let seg

    for (i = 0; i < segs.length; i++) {
      seg = segs[i]
      applyStyle(seg.el, this.generateSegVerticalCss(seg))
    }
  }


  // Generates an object with CSS properties for the top/bottom coordinates of a segment element
  generateSegVerticalCss(seg) {
    return {
      top: seg.top,
      bottom: -seg.bottom // flipped because needs to be space beyond bottom edge of event container
    }
  }


  /* Sizing
  ------------------------------------------------------------------------------------------------------------------*/


  buildPositionCaches() {
    this.colPositions.build()
    this.slatPositions.build()
  }


  /* Hit System
  ------------------------------------------------------------------------------------------------------------------*/

  positionToHit(positionLeft, positionTop) {
    let { dateEnv } = this.context
    let { snapsPerSlot, slatPositions, colPositions } = this

    let colIndex = colPositions.leftToIndex(positionLeft)
    let slatIndex = slatPositions.topToIndex(positionTop)

    if (colIndex != null && slatIndex != null) {
      let slatTop = slatPositions.tops[slatIndex]
      let slatHeight = slatPositions.getHeight(slatIndex)
      let partial = (positionTop - slatTop) / slatHeight // floating point number between 0 and 1
      let localSnapIndex = Math.floor(partial * snapsPerSlot) // the snap # relative to start of slat
      let snapIndex = slatIndex * snapsPerSlot + localSnapIndex

      let dayDate = this.props.cells[colIndex].date
      let time = addDurations(
        this.props.dateProfile.minTime,
        multiplyDuration(this.snapDuration, snapIndex)
      )

      let start = dateEnv.add(dayDate, time)
      let end = dateEnv.add(start, this.snapDuration)

      return {
        col: colIndex,
        dateSpan: {
          range: { start, end },
          allDay: false
        },
        dayEl: this.colEls[colIndex],
        relativeRect: {
          left: colPositions.lefts[colIndex],
          right: colPositions.rights[colIndex],
          top: slatTop,
          bottom: slatTop + slatHeight
        }
      }
    }
  }

}


// Given segments grouped by column, insert the segments' elements into a parallel array of container
// elements, each living within a column.
export function attachSegs({ segs, containerEls }: { segs: Seg[], containerEls: HTMLElement[] }, context: ComponentContext) {
  let segsByCol = groupSegsByCol(segs, containerEls.length)

  for (let col = 0; col < segsByCol.length; col++) {
    segsByCol[col] = sortEventSegs(segsByCol[col], context.eventOrderSpecs)
  }

  for (let col = 0; col < containerEls.length; col++) { // iterate each column grouping
    let segs = segsByCol[col]

    for (let seg of segs) {
      containerEls[col].appendChild(seg.el)
    }
  }

  return segsByCol
}


export function detachSegs(segsByCol: Seg[][]) {
  for (let segGroup of segsByCol) {
    for (let seg of segGroup) {
      removeElement(seg.el)
    }
  }
}


function groupSegsByCol(segs, colCnt) {
  let segsByCol = []
  let i

  for (i = 0; i < colCnt; i++) {
    segsByCol.push([])
  }

  for (i = 0; i < segs.length; i++) {
    segsByCol[segs[i].col].push(segs[i])
  }

  return segsByCol
}
